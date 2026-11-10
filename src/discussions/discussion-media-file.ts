import type { VoiceRecording } from '../voice-note/useVoiceRecorder';
import { createDirectMediaKey, MediaUploadError, validateDirectMedia } from '../media/directMediaUpload';
import { compressGalleryVideo, type VideoProbe } from './video-compression';
import { DISCUSSION_MEDIA_ACCEPT, type DiscussionMediaDraft } from '../data/cloud/discussion-media';

const extensionTypes = new Map([
  ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['png', 'image/png'], ['webp', 'image/webp'],
  ['gif', 'image/gif'], ['heic', 'image/heic'], ['mp4', 'video/mp4'],
  ['mov', 'video/quicktime'], ['webm', 'video/webm'],
]);

function probe(url: string, video: boolean, signal: AbortSignal): Promise<VideoProbe | null> {
  return new Promise((resolve, reject) => {
    const element = video ? document.createElement('video') : new Image();
    const movie = element instanceof HTMLVideoElement ? element : null;
    const failed = () => finish(null, 'Устройство не смогло открыть этот формат или кодек');
    const cancelled = () => finish(null, 'Проверка файла отменена');
    const timer = setTimeout(failed, 15_000);
    const finish = (details: VideoProbe | null, error?: string) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancelled);
      element.onerror = null;
      element.onload = null;
      if (movie) { movie.onloadeddata = null; movie.onloadedmetadata = null; }
      element.removeAttribute('src');
      movie?.load();
      if (error) reject(new Error(error)); else resolve(details);
    };
    element.onerror = failed;
    if (movie) {
      movie.preload = 'auto';
      movie.playsInline = true;
      movie.muted = true;
      movie.onloadedmetadata = () => {
        if (movie.duration > 180) finish(null, 'Видео должно быть не длиннее 3 минут');
        else if (!Number.isFinite(movie.duration) || movie.duration <= 0 || !movie.videoWidth) failed();
      };
      movie.onloadeddata = () => {
        if (Number.isFinite(movie.duration) && movie.duration > 0 && movie.duration <= 180 && movie.videoWidth) finish({ durationSeconds: movie.duration, width: movie.videoWidth, height: movie.videoHeight });
        else failed();
      };
    } else {
      element.onload = () => finish(null);
    }
    if (signal.aborted) cancelled();
    else {
      signal.addEventListener('abort', cancelled, { once: true });
      element.src = url;
    }
  });
}

export async function inspectDiscussionMedia(original: File, signal: AbortSignal) {
  // Some gallery providers omit the MIME type. Decode the actual bytes below.
  const type = !original.type || original.type === 'application/octet-stream'
    ? extensionTypes.get(original.name.split('.').at(-1)?.toLowerCase() ?? '') : original.type;
  const file = type && type !== original.type
    ? new File([original], original.name, { type, lastModified: original.lastModified }) : original;
  const mimeType = (file.type || '').toLowerCase().split(';')[0].trim();
  if (!DISCUSSION_MEDIA_ACCEPT.split(',').includes(mimeType)) {
    throw new Error('Этот формат фото или видео не поддерживается');
  }
  const video = mimeType.startsWith('video/');
  // A video larger than the upload limit can be processed locally first.
  // Do not decode arbitrarily large files in the embedded WebView.
  if (!file.size || (video && file.size > 1024 * 1024 * 1024)) {
    throw new Error('Видео должно быть не больше 1 ГБ до сжатия');
  }
  const url = URL.createObjectURL(file);
  try {
    const inspected = await probe(url, video, signal);
    if (signal.aborted) throw new Error('Проверка файла отменена');
    let selected = file;
    let details = inspected;
    if (video && inspected) {
      const compressed = await compressGalleryVideo(file, inspected, signal);
      if (signal.aborted) throw new Error('Сжатие отменено');
      if (compressed) {
        // Do not send a failed, truncated, or unplayable transcode to another device.
        const compressedUrl = URL.createObjectURL(compressed);
        try {
          const check = await probe(compressedUrl, true, signal);
          if (check && Math.abs(check.durationSeconds - inspected.durationSeconds) <= 2) {
            selected = compressed;
            details = check;
          }
        } catch {
          // Keep the source file when decoding a transcoded result fails.
        } finally {
          URL.revokeObjectURL(compressedUrl);
        }
      }
    }
    let selectedType: string;
    try {
      selectedType = validateDirectMedia(selected);
    } catch (reason) {
      if (reason instanceof MediaUploadError && reason.code === 'INVALID_SIZE') {
        throw new Error('Файл превышает лимит 250 МБ. Устройство не смогло сжать видео до допустимого размера');
      }
      throw new Error('Этот формат фото или видео не поддерживается');
    }
    const metadata: DiscussionMediaDraft = {
      id: crypto.randomUUID(), storageKey: createDirectMediaKey(), mediaType: video ? 'video' : 'photo',
      mimeType: selectedType, sizeBytes: selected.size, durationSeconds: details?.durationSeconds ?? null,
      fileName: selected.name, uploadState: 'uploading',
    };
    return { file: selected, metadata, ...(selected !== file ? { compressed: true } : {}) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function prepareDiscussionVoice(clip: VoiceRecording) {
  const extension = clip.mimeType.startsWith('audio/mp4') ? 'm4a'
    : clip.mimeType.startsWith('audio/ogg') ? 'ogg' : 'webm';
  const file = new File([clip.blob], `Голосовое сообщение.${extension}`, { type: clip.mimeType });
  const metadata: DiscussionMediaDraft = {
    id: crypto.randomUUID(), storageKey: createDirectMediaKey(), mediaType: 'voice',
    mimeType: validateDirectMedia(file), sizeBytes: file.size, durationSeconds: Math.max(1, clip.durationMs) / 1000,
    waveform: clip.waveform, fileName: file.name, uploadState: 'uploading',
  };
  return { file, metadata };
}
