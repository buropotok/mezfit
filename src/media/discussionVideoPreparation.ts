import { APP_ERROR_CODES, withErrorCode } from '../../shared/app-error-codes';
import { DISCUSSION_MEDIA_KEY_PATTERN, DISCUSSION_PHOTO_PREVIEW_MAX_BYTES,
  discussionMediaSenderPrefix } from '../../shared/discussion-media-limits';
import type { DiscussionMediaDraft } from '../data/cloud/discussion-media';
import { createDirectMediaKey, validateDirectMedia } from './directMediaUpload';

const MiB = 1024 * 1024;
const preparationError = (message: string) => new Error(withErrorCode(message, APP_ERROR_CODES.MEDIA_VIDEO_PREPARATION_FAILED));

export function discussionVideoDimensions(width: number, height: number) {
  const limitWidth = width > height ? 1280 : 720;
  const limitHeight = height > width ? 1280 : 720;
  const scale = Math.min(1, limitWidth / width, limitHeight / height);
  return { width: Math.max(2, Math.floor(width * scale / 2) * 2),
    height: Math.max(2, Math.floor(height * scale / 2) * 2) };
}

export function discussionVideoNeedsCompression(width: number, height: number, fps: number, size: number, duration: number) {
  const limitWidth = width > height ? 1280 : 720;
  const limitHeight = height > width ? 1280 : 720;
  return width > limitWidth || height > limitHeight || fps > 30.05 || size > 24 * MiB
    || (size > 6 * MiB && size * 8 / duration > 2_000_000);
}

const decodedFrame = (video: HTMLVideoElement, signal: AbortSignal, time?: number) => new Promise<void>((resolve, reject) => {
  const event = time === undefined ? 'loadeddata' : 'seeked';
  const clear = () => {
    clearTimeout(timer);
    video.removeEventListener(event, ready);
    video.removeEventListener('error', fail);
    signal.removeEventListener('abort', fail);
  };
  const ready = () => { clear(); resolve(); };
  const fail = () => { clear(); reject(preparationError('Устройство не смогло открыть кадр видео. Выберите другой файл.')); };
  const timer = setTimeout(fail, time === undefined ? 12_000 : 3_000);
  video.addEventListener(event, ready);
  video.addEventListener('error', fail);
  signal.addEventListener('abort', fail, { once: true });
  if (signal.aborted) fail();
  else if (time !== undefined) {
    try { video.currentTime = time; } catch { fail(); }
  }
});

async function captureOrientedVideoFrame(canvas: HTMLCanvasElement, file: Blob, duration: number, note: boolean, signal: AbortSignal) {
  const { CanvasSink, Input, BlobSource, MP4, QTFF, WEBM } = await import('mediabunny');
  signal.throwIfAborted();
  const input = new Input({ source: new BlobSource(file), formats: [MP4, QTFF, WEBM] });
  const dispose = () => input.dispose();
  signal.addEventListener('abort', dispose, { once: true });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || (!await track.getRotation() && !await track.getFlip()) || !await track.canDecode()) return false;
    const [width, height, start] = await Promise.all([
      track.getDisplayWidth(), track.getDisplayHeight(), track.getFirstTimestamp(),
    ]);
    const scale = Math.min(1, 480 / Math.max(width, height));
    const sink = new CanvasSink(track, {
      width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), fit: 'contain', poolSize: 1,
    });
    const offset = note ? Math.min(0.04, duration / 2) : Math.min(3, duration / 2);
    const frame = await sink.getCanvas(start + offset) ?? await sink.getCanvas(start);
    if (!frame || frame.canvas.width < 1 || frame.canvas.height < 1) return false;
    signal.throwIfAborted();
    const context = canvas.getContext('2d');
    if (!context) return false;
    canvas.width = frame.canvas.width;
    canvas.height = frame.canvas.height;
    context.drawImage(frame.canvas, 0, 0);
    return true;
  } catch {
    signal.throwIfAborted();
    // Some WebViews decode a file in the native element but not through WebCodecs.
    return false;
  } finally {
    signal.removeEventListener('abort', dispose);
    dispose();
  }
}

function encodeVideoPreview(canvas: HTMLCanvasElement, type: string, quality: number, signal: AbortSignal): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    const finish = (blob: Blob | null) => {
      signal.removeEventListener('abort', cancel);
      resolve(blob);
    };
    const cancel = () => {
      signal.removeEventListener('abort', cancel);
      reject(signal.reason);
    };
    if (signal.aborted) cancel();
    else {
      signal.addEventListener('abort', cancel, { once: true });
      try { canvas.toBlob(finish, type, quality); }
      catch (reason) {
        signal.removeEventListener('abort', cancel);
        reject(reason);
      }
    }
  });
}

async function createDiscussionVideoPreview(file: Blob, duration: number, note: boolean, signal: AbortSignal) {
  signal.throwIfAborted();
  const video = document.createElement('video');
  const canvas = document.createElement('canvas');
  const url = URL.createObjectURL(file);
  try {
    video.preload = 'auto';
    video.playsInline = true;
    video.muted = true;
    const ready = decodedFrame(video, signal);
    video.src = url;
    await ready;

    const maxDuration = note ? 60 : 180;
    const measured = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : duration;
    if (measured <= 0 || measured > maxDuration + (note ? 0.2 : 0)) {
      throw preparationError(note ? 'Видеокружок должен быть не длиннее 1 минуты.' : 'Видео должно быть не длиннее 3 минут.');
    }
    if (!video.videoWidth || !video.videoHeight) throw preparationError('В видео нет доступных кадров.');
    const playbackDuration = Math.min(maxDuration, measured);
    if (!await captureOrientedVideoFrame(canvas, file, playbackDuration, note, signal)) {
      const scale = Math.min(1, 480 / Math.max(video.videoWidth, video.videoHeight));
      const width = Math.max(1, Math.round(video.videoWidth * scale));
      const height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context || video.readyState < 2) throw preparationError('В видео нет доступных кадров.');
      canvas.width = width;
      canvas.height = height;
      const draw = () => context.drawImage(video, 0, 0, width, height);
      const hasLight = () => context.getImageData(0, 0, width, height).data
        .some((value, index) => index % 4 !== 3 && value > 16);
      draw();
      const first = hasLight() ? context.getImageData(0, 0, width, height) : undefined;
      const target = note ? Math.min(0.04, playbackDuration / 2)
        : playbackDuration > 3.04 ? 3 : playbackDuration / 2;
      for (const time of new Set([target, playbackDuration / 2])) {
        if (time <= 0 || Math.abs(video.currentTime - time) < 0.001) continue;
        try { await decodedFrame(video, signal, time); }
        catch { signal.throwIfAborted(); continue; }
        if (video.readyState < 2) continue;
        draw();
        if (hasLight()) break;
        if (first) context.putImageData(first, 0, 0);
      }
    }
    const { width, height } = canvas;
    let bounded: Blob | undefined;
    let format = 'image/webp';
    for (const [size, quality] of [[480, 0.82], [480, 0.68], [400, 0.66], [320, 0.55], [240, 0.45]]) {
      signal.throwIfAborted();
      const thumb = document.createElement('canvas');
      try {
        const ratio = Math.min(1, size / Math.max(width, height));
        thumb.width = Math.max(1, Math.round(width * ratio));
        thumb.height = Math.max(1, Math.round(height * ratio));
        const ctx = thumb.getContext('2d');
        if (!ctx) break;
        ctx.drawImage(canvas, 0, 0, thumb.width, thumb.height);
        const encode = (type: string) => encodeVideoPreview(thumb, type, quality, signal);
        let blob = await encode(format);
        if (format === 'image/webp' && blob?.type !== format) {
          format = 'image/jpeg';
          blob = await encode(format);
        }
        signal.throwIfAborted();
        if (!blob || blob.type !== format || !blob.size || blob.size > DISCUSSION_PHOTO_PREVIEW_MAX_BYTES) continue;
        if (blob.size <= 50 * 1024) return { thumbnail: blob, duration: playbackDuration };
        if (!bounded || blob.size < bounded.size) bounded = blob;
      } finally {
        thumb.width = thumb.height = 0;
      }
    }
    if (bounded) return { thumbnail: bounded, duration: playbackDuration };
    throw preparationError('Не удалось создать обложку видео. Выберите другой файл.');
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
    canvas.width = canvas.height = 0;
  }
}

async function prepareVideoFile(file: File, signal: AbortSignal, onProgress: (value: number) => void) {
  if (!file.size || file.size > 1024 * MiB) throw preparationError('Выберите видео размером до 1 ГБ.');
  const media = await import('mediabunny');
  signal.throwIfAborted();
  const open = (source: Blob) => new media.Input({ source: new media.BlobSource(source),
    formats: [media.MP4, media.QTFF, media.WEBM] });
  const input = open(file);
  const dispose = () => input.dispose();
  signal.addEventListener('abort', dispose, { once: true });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw preparationError('В файле нет видеодорожки.');
    const [end, start, width, height, rate, audio, mime] = await Promise.all([
      input.computeDuration(), input.getFirstTimestamp(), video.getDisplayWidth(), video.getDisplayHeight(),
      video.computeFrameRateMetrics(), input.getPrimaryAudioTrack(), input.getMimeType(),
    ]);
    const duration = end - start;
    signal.throwIfAborted();
    if (!Number.isFinite(duration) || duration <= 0 || duration > 180) throw preparationError('Видео должно быть не длиннее 3 минут.');
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 35_000_000) {
      throw preparationError('Не удалось определить размер кадра видео.');
    }
    const type = mime.split(';', 1)[0];
    if (!discussionVideoNeedsCompression(width, height, rate.bestGuessFrameRate, file.size, duration)) {
      const full = type === file.type ? file : new File([file], file.name, { type });
      validateDirectMedia(full);
      return { file: full, duration };
    }
    if (!await video.canDecode()) throw preparationError('Кодек видео недоступен на этом устройстве. Выберите другой файл.');
    const { width: outputWidth, height: outputHeight } = discussionVideoDimensions(width, height);
    const audioBitrate = audio ? 80_000 : 0;
    const bitrateBudget = Math.min(18 * MiB, file.size * 0.8) * 8 / duration;
    const videoBitrate = Math.round(Math.max(150_000, Math.min(2_000_000, bitrateBudget - audioBitrate)));
    const player = document.createElement('video');
    const profiles = [
      { format: new media.Mp4OutputFormat({ fastStart: 'in-memory' }), video: 'avc', audio: 'aac', extension: 'mp4', type: 'video/mp4',
        playback: 'video/mp4; codecs="avc1.42E01F, mp4a.40.2"' },
      { format: new media.WebMOutputFormat(), video: 'vp8', audio: 'opus', extension: 'webm', type: 'video/webm',
        playback: 'video/webm; codecs="vp8, opus"' },
    ] as const;
    for (const profile of profiles) {
      signal.throwIfAborted();
      if (!player.canPlayType(audio ? profile.playback : profile.type)) continue;
      const target = new media.BufferTarget();
      const output = new media.Output({ format: profile.format, target });
      try {
        const conversion = await media.Conversion.init({ input, output, tracks: 'primary', showWarnings: false,
          video: { width: outputWidth, height: outputHeight, fit: 'contain',
            frameRate: Math.max(1, Math.min(30, Math.round(rate.bestGuessFrameRate) || 30)),
            allowTransformationMetadata: false, forceTranscode: true, codec: profile.video, bitrate: videoBitrate },
          audio: { codec: profile.audio, bitrate: 80_000 } });
        const cancel = () => { void conversion.cancel().catch(() => undefined); };
        signal.addEventListener('abort', cancel, { once: true });
        try {
          signal.throwIfAborted();
          if (!conversion.isValid || !conversion.utilizedTracks.includes(video)
            || (audio && !conversion.utilizedTracks.includes(audio))) continue;
          conversion.onProgress = onProgress;
          await conversion.execute();
        } finally {
          signal.removeEventListener('abort', cancel);
          if (conversion.state === 'idle' || conversion.state === 'executing') await conversion.cancel();
        }
        signal.throwIfAborted();
        if (!target.buffer || target.buffer.byteLength >= file.size * 0.9) continue;
        const name = file.name.replace(/\.[^.]+$/, '');
        const full = new File([target.buffer], `${name}.${profile.extension}`, { type: profile.type });
        validateDirectMedia(full);
        const verification = open(full);
        const disposeVerification = () => verification.dispose();
        signal.addEventListener('abort', disposeVerification, { once: true });
        try {
          const result = await verification.getPrimaryVideoTrack();
          if (!result || (await verification.getMimeType()).split(';', 1)[0] !== profile.type
            || Boolean(await verification.getPrimaryAudioTrack()) !== Boolean(audio)) continue;
          const [w, h, resultDuration, rotation, flip, fps] = await Promise.all([
            result.getDisplayWidth(), result.getDisplayHeight(), verification.computeDuration(),
            result.getRotation(), result.getFlip(), result.computeFrameRateMetrics(),
          ]);
          if (w !== outputWidth || h !== outputHeight || rotation || flip || fps.bestGuessFrameRate > 30.05 || !Number.isFinite(resultDuration)
            || resultDuration <= 0 || resultDuration > 180 || Math.abs(resultDuration - duration) > 0.25) continue;
          return { file: full, duration: resultDuration };
        } finally {
          signal.removeEventListener('abort', disposeVerification);
          disposeVerification();
        }
      } catch {
        signal.throwIfAborted();
        // A second container/codec is the only fallback. The original requires compression.
      }
    }
    throw preparationError('Не удалось сжать видео на этом устройстве. Выберите меньший файл или другой формат.');
  } finally {
    signal.removeEventListener('abort', dispose);
    dispose();
  }
}

export async function prepareDiscussionVideoPair(
  source: File, accountId: string, parentSignal: AbortSignal, onProgress: (value: number | null) => void,
  note?: DiscussionMediaDraft,
): Promise<{ file: File; metadata: DiscussionMediaDraft; thumbnail: Blob }> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const timer = setTimeout(cancel, 180_000);
  parentSignal.addEventListener('abort', cancel, { once: true });
  try {
    parentSignal.throwIfAborted();
    const { file, duration } = note
      ? { file: source, duration: note.durationSeconds ?? 0 }
      : await prepareVideoFile(source, controller.signal, onProgress);
    onProgress(null);
    const preview = await createDiscussionVideoPreview(file, duration, Boolean(note), controller.signal);
    const { thumbnail } = preview;
    const id = DISCUSSION_MEDIA_KEY_PATTERN.exec(createDirectMediaKey())?.[3];
    if (!id) throw preparationError('Не удалось создать ключ вложения.');
    const prefix = `mvp-media/${await discussionMediaSenderPrefix(accountId)}`;
    controller.signal.throwIfAborted();
    return { file, thumbnail, metadata: {
      id, storageKey: `${prefix}/full/${id}`, mediaType: note ? 'video-note' : 'video',
      mimeType: validateDirectMedia(file), sizeBytes: file.size, durationSeconds: preview.duration, fileName: file.name,
      uploadState: 'uploading',
      preview: { storageKey: `${prefix}/preview/${id}`, mimeType: thumbnail.type, sizeBytes: thumbnail.size },
    } };
  } catch (error) {
    parentSignal.throwIfAborted();
    if (controller.signal.aborted) throw preparationError('Подготовка видео заняла слишком много времени. Выберите другой файл.');
    if (error instanceof Error && error.message.endsWith(`(Код: ${APP_ERROR_CODES.MEDIA_VIDEO_PREPARATION_FAILED})`)) throw error;
    throw preparationError('Не удалось подготовить видео. Проверьте формат файла и свободное место и попробуйте снова.');
  } finally {
    clearTimeout(timer);
    parentSignal.removeEventListener('abort', cancel);
  }
}
