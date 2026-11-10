/**
 * Best-effort local video transcode for the gallery. No network, native bridge or WASM.
 * The Mini App cannot invoke Telegram's Android MediaCodec pipeline. Unsupported
 * WebViews keep the original file; an oversized original is rejected by the caller.
 */
export const COMPRESS_VIDEO_ABOVE_BYTES = 20 * 1024 * 1024;
const MAX_SIDE = 854;
const VIDEO_BITRATE = 750_000;
const AUDIO_BITRATE = 96_000;
const FRAME_RATE = 24;

export interface VideoProbe {
  durationSeconds: number;
  width: number;
  height: number;
}

export function videoCompressionSize(width: number, height: number): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Некорректные размеры видео');
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  // Video encoders commonly require even dimensions.
  return {
    width: Math.max(2, Math.floor(width * scale / 2) * 2),
    height: Math.max(2, Math.floor(height * scale / 2) * 2),
  };
}

function recordingMime(): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return null;
  return [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ].find(type => MediaRecorder.isTypeSupported(type)) ?? null;
}

/** A null result means compression is unavailable or failed safely. */
export async function compressGalleryVideo(file: File, info: VideoProbe, signal: AbortSignal): Promise<File | null> {
  if (file.size <= COMPRESS_VIDEO_ABOVE_BYTES || signal.aborted || !Number.isFinite(info.durationSeconds)
    || info.durationSeconds <= 0 || info.durationSeconds > 180 || !recordingMime()) return null;
  const mime = recordingMime();
  if (!mime) return null;
  const canvas = document.createElement('canvas');
  if (typeof canvas.captureStream !== 'function') return null;
  const video = document.createElement('video');
  const capture = video as HTMLVideoElement & { captureStream?: () => MediaStream };
  if (typeof capture.captureStream !== 'function') return null;

  const target = videoCompressionSize(info.width, info.height);
  canvas.width = target.width;
  canvas.height = target.height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return null;

  video.muted = true; // Captured audio is unaffected by element.muted, per Media Capture spec.
  video.playsInline = true;
  video.preload = 'auto';
  video.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
  const src = URL.createObjectURL(file);
  video.src = src;
  document.body.append(video);
  let canvasStream: MediaStream | null = null;
  let originalStream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let frameId = 0;
  try {
    const result = await new Promise<File>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const chunks: Blob[] = [];
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        const type = (recorder?.mimeType || mime).split(';')[0];
        const ext = type === 'video/mp4' ? 'mp4' : 'webm';
        const name = file.name.replace(/\.[^./\\]+$/, '') + '-compressed.' + ext;
        resolve(new File(chunks, name, { type, lastModified: file.lastModified }));
      };
      const cancel = () => fail(new Error('Сжатие отменено'));
      const invisible = () => {
        if (document.visibilityState === 'hidden') fail(new Error('Приложение было свёрнуто'));
      };
      const cleanup = () => {
        if (timer !== undefined) clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        document.removeEventListener('visibilitychange', invisible);
      };
      const draw = () => {
        if (settled) return;
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !video.ended) {
          context.drawImage(video, 0, 0, target.width, target.height);
        }
        frameId = requestAnimationFrame(draw);
      };
      const start = async () => {
        try {
          if (signal.aborted || document.visibilityState === 'hidden') throw new Error('Сжатие отменено');
          if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
            await new Promise<void>((ok, bad) => {
              video.onloadeddata = () => ok();
              video.onerror = () => bad(new Error('Видео не удалось открыть'));
            });
          }
          if (settled) return;
          // On Android this captures existing audio without altering its volume.
          originalStream = capture.captureStream?.() ?? null;
          if (!originalStream) throw new Error('Захват видео недоступен');
          canvasStream = canvas.captureStream(FRAME_RATE);
          const tracks = [...canvasStream.getVideoTracks(), ...originalStream.getAudioTracks()];
          if (tracks.length === 0) throw new Error('Захват дорожек недоступен');
          const stream = new MediaStream(tracks);
          recorder = new MediaRecorder(stream, {
            mimeType: mime, videoBitsPerSecond: VIDEO_BITRATE, audioBitsPerSecond: AUDIO_BITRATE,
          });
          recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
          recorder.onerror = () => fail(new Error('Ошибка видеокодировщика'));
          recorder.onstop = finish;
          video.onended = () => {
            if (recorder?.state === 'recording') recorder.stop();
          };
          recorder.start(1000);
          draw();
          await video.play();
        } catch (error) {
          fail(error instanceof Error ? error : new Error('Сжатие недоступно'));
        }
      };
      signal.addEventListener('abort', cancel, { once: true });
      document.addEventListener('visibilitychange', invisible);
      timer = setTimeout(() => fail(new Error('Превышено время сжатия')),
        Math.ceil(info.durationSeconds * 1000) + 30_000);
      void start();
    });
    if (signal.aborted || !result.size || result.size >= file.size) return null;
    return result;
  } catch {
    // Retain the original if the WebView cannot transcode or the user cancels.
    return null;
  } finally {
    cancelAnimationFrame(frameId);
    if (recorder?.state === 'recording') recorder.stop();
    recorder && (recorder.onstop = null);
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
    originalStream?.getTracks().forEach(track => track.stop());
    canvasStream?.getTracks().forEach(track => track.stop());
    URL.revokeObjectURL(src);
  }
}
