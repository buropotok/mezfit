import { encodeTrimStart, writeTrimWithEncodedStart } from './videoTrimAvc';

export interface VideoTrimRange {
  start: number;
  end: number;
}

export interface VideoTrimInfo {
  duration: number;
  timelineStart: number;
}

export const MIN_VIDEO_TRIM_SECONDS = 0.2;

export async function inspectVideoTrim(blob: Blob, signal: AbortSignal): Promise<VideoTrimInfo> {
  const { Input, MP4, WEBM, BlobSource } = await import('mediabunny');
  signal.throwIfAborted();
  const input = new Input({ formats: [MP4, WEBM], source: new BlobSource(blob) });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('Video track missing');
    const timelineStart = Math.max(0, await input.getFirstTimestamp());
    const duration = await input.computeDuration() - timelineStart;
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid video duration');

    signal.throwIfAborted();
    return { duration, timelineStart };
  } finally {
    input.dispose();
  }
}

export async function trimRecordedMp4(blob: Blob, info: VideoTrimInfo, range: VideoTrimRange, signal: AbortSignal) {
  if (range.start === 0 && range.end === info.duration) return blob;
  const media = await import('mediabunny');
  const { Input, MP4, BlobSource, Conversion, Output, Mp4OutputFormat, BufferTarget, EncodedPacketSink } = media;
  signal.throwIfAborted();
  const input = new Input({ formats: [MP4], source: new BlobSource(blob) });
  const target = new BufferTarget();
  const abortInput = () => input.dispose();
  signal.addEventListener('abort', abortInput, { once: true });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error('Video track missing');
    const packets = new EncodedPacketSink(video);
    const requestedStart = range.start + info.timelineStart;
    const end = range.end + info.timelineStart;
    const verify = { verifyKeyPackets: true };
    // Choose the frame displayed at the requested time, including exact frame boundaries.
    const frame = await packets.getPacket(requestedStart + 0.000001, verify) ?? await packets.getFirstPacket(verify);
    if (!frame || frame.timestamp >= end) throw new Error('No video frame in trim range');
    const start = range.start === 0 ? requestedStart : frame.timestamp;
    if (range.start > 0 && frame.type !== 'key') {
      const previousKey = await packets.getKeyPacket(frame.timestamp, verify);
      if (!previousKey) throw new Error('No starting keyframe');
      const nextKey = await packets.getNextKeyPacket(previousKey, verify);
      const join = nextKey && nextKey.timestamp < end ? nextKey : null;
      const prefix = await encodeTrimStart(media, video, frame.timestamp, join?.timestamp ?? end, signal);
      return await writeTrimWithEncodedStart(media, input, video, prefix, { start: frame.timestamp, end }, join, signal);
    }
    const conversion = await Conversion.init({
      input,
      output: new Output({ format: new Mp4OutputFormat(), target }),
      trim: { start, end },
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
    signal.removeEventListener('abort', abortInput);
    input.dispose();
  }
}
