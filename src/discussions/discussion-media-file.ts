import { APP_ERROR_CODES, withErrorCode } from '../../shared/app-error-codes';
import type { VideoRecordingErrorCode } from '../../shared/video-recording-diagnostic';
import { reportVideoRecordingFailure } from '../video-note/video-recording-diagnostics';
import type { VoiceRecording } from '../voice-note/useVoiceRecorder';
import type { VideoNoteRecording } from '../video-note/useVideoNoteRecorder';
import { createDirectMediaKey, MediaUploadError, validateDirectMedia } from '../media/directMediaUpload';
import { DISCUSSION_MEDIA_ACCEPT, type DiscussionMediaDraft } from '../data/cloud/discussion-media';

const extensionTypes = new Map([
  ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['png', 'image/png'], ['webp', 'image/webp'],
  ['gif', 'image/gif'], ['heic', 'image/heic'], ['mp4', 'video/mp4'],
  ['mov', 'video/quicktime'], ['webm', 'video/webm'],
]);

/**
 * Browser decode probe. Do not change validation decisions in this diagnostic-only phase:
 * distinguish browser media errors, metadata rejection, frame rejection and timeout.
 */
function probe(url: string, video: boolean, signal: AbortSignal, mimeType: string, sizeBytes: number): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const element = video ? document.createElement('video') : new Image();
    const movie = element instanceof HTMLVideoElement ? element : null;
    let completed = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (duration: number | null, message?: string) => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancelled);
      element.onerror = null;
      element.onload = null;
      if (movie) { movie.onloadeddata = null; movie.onloadedmetadata = null; }
      element.removeAttribute('src');
      movie?.load();
      if (message) reject(new Error(message)); else resolve(duration);
    };
    const failed = (code: VideoRecordingErrorCode, message = 'Устройство не смогло открыть этот формат или кодек') => {
      if (completed) return;
      reportVideoRecordingFailure(code, 'media', {
        mediaMimeType: mimeType,
        mediaSizeBytes: String(sizeBytes),
        ...(movie ? {
          mediaErrorCode: String(movie.error?.code ?? 0),
          mediaReadyState: String(movie.readyState),
          mediaNetworkState: String(movie.networkState),
        } : {}),
      });
      finish(null, withErrorCode(message, code));
    };
    const cancelled = () => finish(null, withErrorCode('Проверка файла отменена', APP_ERROR_CODES.MEDIA_CHECK_CANCELLED));
    timer = setTimeout(() => failed(APP_ERROR_CODES.MEDIA_CHECK_TIMEOUT), 15_000);
    element.onerror = () => failed(video ? APP_ERROR_CODES.MEDIA_VIDEO_DECODE_FAILED : APP_ERROR_CODES.MEDIA_PHOTO_DECODE_FAILED);
    if (movie) {
      movie.preload = 'auto';
      movie.playsInline = true;
      movie.muted = true;
      movie.onloadedmetadata = () => {
        if (movie.duration > 180) finish(null, withErrorCode('Видео должно быть не длиннее 3 минут', APP_ERROR_CODES.MEDIA_VIDEO_TOO_LONG));
        else if (!Number.isFinite(movie.duration) || movie.duration <= 0 || !movie.videoWidth) {
          failed(APP_ERROR_CODES.MEDIA_VIDEO_METADATA_INVALID);
        }
      };
      movie.onloadeddata = () => {
        if (Number.isFinite(movie.duration) && movie.duration > 0 && movie.duration <= 180 && movie.videoWidth) {
          finish(movie.duration);
        } else failed(APP_ERROR_CODES.MEDIA_VIDEO_FRAME_INVALID);
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

export function discussionMediaInputMime(original: File) {
  return !original.type || original.type === 'application/octet-stream'
    ? extensionTypes.get(original.name.split('.').at(-1)?.toLowerCase() ?? '') : original.type;
}

export async function inspectDiscussionMedia(original: File, signal: AbortSignal) {
  // Some gallery providers omit the MIME type. Decode the actual bytes below.
  const type = discussionMediaInputMime(original);
  const file = type && type !== original.type
    ? new File([original], original.name, { type, lastModified: original.lastModified }) : original;
  let mimeType: string;
  try {
    mimeType = validateDirectMedia(file);
    if (!DISCUSSION_MEDIA_ACCEPT.split(',').includes(mimeType)) throw new MediaUploadError('INVALID_TYPE');
  } catch (reason) {
    if (reason instanceof MediaUploadError && reason.code === 'INVALID_SIZE') {
      throw new Error(withErrorCode('Файл пустой или превышает лимит. Фото до 20 МБ, видео до 250 МБ', APP_ERROR_CODES.MEDIA_INVALID_SIZE));
    }
    throw new Error(withErrorCode('Этот формат фото или видео не поддерживается', APP_ERROR_CODES.MEDIA_INVALID_FORMAT));
  }
  const video = mimeType.startsWith('video/');
  const url = URL.createObjectURL(file);
  try {
    const durationSeconds = await probe(url, video, signal, mimeType, file.size);
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
