import type { Input } from 'mediabunny';

export interface VideoOrientation {
  width: number;
  height: number;
  rotation: number;
  flip?: boolean;
}

/** Metadata only, using the same resolved local/signed URL as native playback. */
export async function readVideoOrientation(src: string, signal: AbortSignal): Promise<VideoOrientation | null> {
  let input: Input | undefined;
  let expired = false;
  const dispose = () => input?.dispose();
  const timeout = setTimeout(() => { expired = true; dispose(); }, 5000);
  signal.addEventListener('abort', dispose, { once: true });
  try {
    const { Input, MP4, QTFF, WEBM, UrlSource } = await import('mediabunny');
    signal.throwIfAborted();
    if (expired) return null;
    input = new Input({ formats: [MP4, QTFF, WEBM], source: new UrlSource(src, {
      getRetryDelay: () => null,
      maxCacheSize: 1024 * 1024,
      parallelism: 1,
      handleUnhandledError: () => { /* Optional metadata never owns playback failure UI. */ },
    }) });
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    const [width, height, rotation, flip] = await Promise.all([
      track.getSquarePixelWidth(), track.getSquarePixelHeight(), track.getRotation(), track.getFlip(),
    ]);
    signal.throwIfAborted();
    return { width, height, rotation, ...(flip ? { flip } : {}) };
  } catch {
    // CORS, unsupported containers or cancelled metadata reads must not stop playback.
    return null;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', dispose);
    dispose();
  }
}

export function rotatedVideoScale(
  width: number, height: number, frameWidth: number, frameHeight: number, fit: 'contain' | 'cover',
): number {
  if (Math.min(width, height, frameWidth, frameHeight) <= 0) return 1;
  const fitScale = fit === 'cover' ? Math.max : Math.min;
  return fitScale(width / frameHeight, height / frameWidth) / fitScale(width / frameWidth, height / frameHeight);
}
