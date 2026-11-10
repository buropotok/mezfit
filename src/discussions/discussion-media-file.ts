import type { VoiceRecording } from '../voice-note/useVoiceRecorder';
import type { VideoNoteRecording } from '../video-note/useVideoNoteRecorder';
import { createDirectMediaKey, MediaUploadError, validateDirectMedia } from '../media/directMediaUpload';
import { DISCUSSION_MEDIA_ACCEPT, type DiscussionMediaDraft } from '../data/cloud/discussion-media';

const extensionTypes = new Map([
  ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['png', 'image/png'], ['webp', 'image/webp'],
  ['gif', 'image/gif'], ['heic', 'image/heic'], ['mp4', 'video/mp4'],
  ['mov', 'video/quicktime'], ['webm', 'video/webm'],
]);

function probe(url: string, video: boolean, signal: AbortSignal): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const element = video ? document.createElement('video') : new Image();
    const movie = element instanceof HTMLVideoElement ? element : null;
    const failed = () => finish(null, 'Устройство не смогло открыть этот формат или кодек');
    const cancelled = () => finish(null, 'Проверка файла отменена');
    const timer = setTimeout(failed, 15_000);
    const finish = (duration: number | null, error?: string) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancelled);
      element.onerror = null;
      element.onload = null;
      if (movie) { movie.onloadeddata = null; movie.onloadedmetadata = null; }
      element.removeAttribute('src');
      movie?.load();
      if (error) reject(new Error(error)); else resolve(duration);
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
        if (Number.isFinite(movie.duration) && movie.duration > 0 && movie.duration <= 180 && movie.videoWidth) finish(movie.duration);
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
  let mimeType: string;
  try {
    mimeType = validateDirectMedia(file);
    if (!DISCUSSION_MEDIA_ACCEPT.split(',').includes(mimeType)) throw new MediaUploadError('INVALID_TYPE');
  } catch (reason) {
    if (reason instanceof MediaUploadError && reason.code === 'INVALID_SIZE') {
      throw new Error('Файл пустой или превышает лимит. Фото до 20 МБ, видео до 250 МБ');
    }
    throw new Error('Этот формат фото или видео не поддерживается');
  }
  const video = mimeType.startsWith('video/');
  const url = URL.createObjectURL(file);
  try {
    const durationSeconds = await probe(url, video, signal);
    const metadata: DiscussionMediaDraft = {
      id: crypto.randomUUID(), storageKey: createDirectMediaKey(), mediaType: video ? 'video' : 'photo',
      mimeType, sizeBytes: file.size, durationSeconds, fileName: file.name,
      uploadState: 'uploading',
    };
    return { file, metadata };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function prepareDiscussionVideoNote(clip: VideoNoteRecording) {
  const extension = clip.mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
  const file = new File([clip.blob], 'Видеокружок.' + extension, { type: clip.mimeType });
  const metadata: DiscussionMediaDraft = {
    id: crypto.randomUUID(), storageKey: createDirectMediaKey(), mediaType: 'video-note',
    mimeType: validateDirectMedia(file), sizeBytes: file.size,
    durationSeconds: Math.min(60, Math.max(1, clip.durationMs) / 1000),
    fileName: file.name, uploadState: 'uploading',
  };
  return { file, metadata };
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
