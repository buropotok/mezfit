import type { VideoTrimInfo, VideoTrimRange } from './videoTrim';

export type WebmTrimResult = {
  blob: Blob;
  mode: 'exact' | 'keyframe';
};

type TrimFailure = 'exact_failed' | 'keyframe_failed';

/**
 * WebM's exact path requires VP8/VP9 and Opus WebCodecs decode/encode.
 * If unavailable, copy the encoded packets on keyframe boundaries instead.
 * Neither path changes the container to MP4.
 */
export async function trimRecordedWebm(
  blob: Blob, info: VideoTrimInfo, range: VideoTrimRange, signal: AbortSignal,
  onExactFailed?: (reason: string) => void,
): Promise<WebmTrimResult> {
  if (range.start === 0 && range.end === info.duration) return { blob, mode: 'exact' };
  signal.throwIfAborted();

  const media = await import('mediabunny');
  const { Input, WebM, BlobSource, Conversion, Output, WebMOutputFormat, BufferTarget } = media;
  const start = range.start + info.timelineStart;
  const end = range.end + info.timelineStart;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('Invalid WebM trim range');

  async function convert(copy: boolean, policy: 'shrink' | 'expand' = 'shrink'): Promise<Blob> {
    signal.throwIfAborted();
    const input = new Input({ formats: [WebM], source: new BlobSource(blob) });
    const outputTarget = new BufferTarget();
    const output = new Output({ format: new WebMOutputFormat(), target: outputTarget });
    const cancelInput = () => input.dispose();
    signal.addEventListener('abort', cancelInput, { once: true });
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error('WebM video track missing');
      const codec = await track.getCodec();
      if (codec !== 'vp8' && codec !== 'vp9') throw new Error('Unsupported WebM video codec');
      const conversion = await Conversion.init({
        input,
        output,
        trim: { start, end },
        copy: copy ? { mode: 'forced', boundaryPolicy: policy, boundaryTolerance: Infinity } : false,
        ...(!copy ? { video: { codec }, audio: { codec: 'opus' as const } } : {}),
        showWarnings: false,
      });
      signal.throwIfAborted();
      if (!conversion.isValid || conversion.discardedTracks.length) {
        throw new Error(copy ? 'WebM keyframe copy unavailable' : 'WebM exact encoding unavailable');
      }
      const abort = () => { void conversion.cancel().catch(() => {}); };
      signal.addEventListener('abort', abort, { once: true });
      try {
        await conversion.execute();
        signal.throwIfAborted();
        if (!outputTarget.buffer?.byteLength) throw new Error('Empty WebM result');
        const result = new Blob([outputTarget.buffer], { type: 'video/webm' });
        // Do not silently accept an audio-only output or a corrupt WebM.
        const check = new Input({ formats: [WebM], source: new BlobSource(result) });
        try {
          if (!(await check.getPrimaryVideoTrack())) throw new Error('Trimmed WebM lacks video');
          if (!(await check.computeDuration() > 0)) throw new Error('Trimmed WebM has no duration');
        } finally {
          check.dispose();
        }
        return result;
      } finally {
        signal.removeEventListener('abort', abort);
      }
    } finally {
      signal.removeEventListener('abort', cancelInput);
      input.dispose();
    }
  }

  try {
    return { blob: await convert(false), mode: 'exact' };
  } catch (reason) {
    signal.throwIfAborted();
    onExactFailed?.(reason instanceof Error ? reason.name : 'unknown');
  }

  // Shrink never exposes video before the user's requested start boundary.
  // A very short selection without an interior keyframe may not be copyable.
  try {
    return { blob: await convert(true, 'shrink'), mode: 'keyframe' };
  } catch {
    signal.throwIfAborted();
    throw new Error('WEBM_KEYFRAME_TRIM_UNAVAILABLE');
  }
}
