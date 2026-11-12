export interface VideoTrimRange {
  start: number;
  end: number;
}

export interface VideoTrimInfo {
  duration: number;
  timelineStart: number;
  keyframes: number[];
}

export const MIN_VIDEO_TRIM_SECONDS = 0.2;

export function nearestTrimStart(keyframes: readonly number[], requested: number, end: number) {
  return keyframes.reduce((nearest, frame) => frame <= end - MIN_VIDEO_TRIM_SECONDS
    && Math.abs(frame - requested) < Math.abs(nearest - requested) ? frame : nearest, 0);
}

export async function inspectVideoTrim(blob: Blob, signal: AbortSignal): Promise<VideoTrimInfo> {
  const { Input, MP4, BlobSource, EncodedPacketSink } = await import('mediabunny');
  signal.throwIfAborted();
  const input = new Input({ formats: [MP4], source: new BlobSource(blob) });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('Video track missing');
    const timelineStart = Math.max(0, await input.getFirstTimestamp());
    const duration = await input.computeDuration() - timelineStart;
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid video duration');

    const sink = new EncodedPacketSink(track);
    const keyframes = new Set([0]);
    const options = { metadataOnly: true };
    let key = await sink.getFirstKeyPacket(options);
    while (key) {
      signal.throwIfAborted();
      const timestamp = key.timestamp - timelineStart;
      if (timestamp > 0 && timestamp < duration) keyframes.add(timestamp);
      key = await sink.getNextKeyPacket(key, options);
    }
    return { duration, timelineStart, keyframes: [...keyframes].sort((a, b) => a - b) };
  } finally {
    input.dispose();
  }
}

export async function trimRecordedMp4(blob: Blob, info: VideoTrimInfo, range: VideoTrimRange, signal: AbortSignal) {
  if (range.start === 0 && range.end === info.duration) return blob;
  const { Input, MP4, BlobSource, Conversion, Output, Mp4OutputFormat, BufferTarget } = await import('mediabunny');
  signal.throwIfAborted();
  const input = new Input({ formats: [MP4], source: new BlobSource(blob) });
  const target = new BufferTarget();
  try {
    const conversion = await Conversion.init({
      input,
      output: new Output({ format: new Mp4OutputFormat(), target }),
      trim: { start: range.start + info.timelineStart, end: range.end + info.timelineStart },
      copy: { mode: 'forced', boundaryPolicy: 'shrink', boundaryTolerance: 0.05 },
      showWarnings: false,
    });
    signal.throwIfAborted();
    if (!conversion.isValid || conversion.discardedTracks.length) throw new Error('Cannot trim every track without re-encoding');
    const abort = () => { void conversion.cancel().catch(() => {}); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      await conversion.execute();
      signal.throwIfAborted();
      if (!target.buffer?.byteLength) throw new Error('Empty trimmed video');
      return new Blob([target.buffer], { type: 'video/mp4' });
    } finally {
      signal.removeEventListener('abort', abort);
    }
  } finally {
    input.dispose();
  }
}
