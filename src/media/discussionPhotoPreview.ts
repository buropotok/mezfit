import { DISCUSSION_MEDIA_KEY_PATTERN, DISCUSSION_PHOTO_PREVIEW_MAX_BYTES,
  discussionMediaSenderPrefix } from '../../shared/discussion-media-limits';
import type { DiscussionMediaDraft } from '../data/cloud/discussion-media';
import { photoMediaKey } from './directMediaUpload';

const attempts = [
  { maxSide: 480, quality: 0.82 }, { maxSide: 480, quality: 0.68 },
  { maxSide: 400, quality: 0.66 }, { maxSide: 320, quality: 0.55 },
  { maxSide: 240, quality: 0.45 },
];

export async function createDiscussionPhotoPreview(file: Blob, signal: AbortSignal): Promise<Blob> {
  const source = URL.createObjectURL(file);
  const image = new Image();
  const canvas = document.createElement('canvas');
  const failure = () => new Error('Не удалось создать миниатюру фотографии. Выберите другое фото.');
  try {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        image.onload = image.onerror = null;
        if (error) reject(error); else resolve();
      };
      const cancel = () => finish(failure());
      const timer = setTimeout(cancel, 15_000);
      image.onload = () => finish();
      image.onerror = cancel;
      if (signal.aborted) cancel();
      else {
        signal.addEventListener('abort', cancel, { once: true });
        image.src = source;
      }
    });
    // Use the browser-oriented image dimensions and pixels, including EXIF orientation.
    const { naturalWidth: width, naturalHeight: height } = image;
    const context = canvas.getContext('2d');
    if (!context || width < 1 || height < 1) throw failure();
    let format = 'image/webp';
    let bounded: Blob | undefined;
    for (const { maxSide, quality } of attempts) {
      if (signal.aborted) throw failure();
      const scale = Math.min(1, maxSide / Math.max(width, height));
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const encode = (type: string) => new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality));
      let blob = await encode(format);
      if (format === 'image/webp' && blob?.type !== 'image/webp') {
        format = 'image/jpeg';
        blob = await encode(format);
      }
      if (!signal.aborted && blob?.type === format && blob.size > 0 && blob.size <= DISCUSSION_PHOTO_PREVIEW_MAX_BYTES) {
        if (blob.size <= 50 * 1024) return blob;
        if (!bounded || blob.size < bounded.size) bounded = blob;
      }
    }
    if (bounded && !signal.aborted) return bounded;
    throw failure();
  } finally {
    image.removeAttribute('src');
    URL.revokeObjectURL(source);
    canvas.width = canvas.height = 0;
  }
}

export async function prepareDiscussionPhoto(
  file: File, metadata: DiscussionMediaDraft, accountId: string, signal: AbortSignal,
): Promise<{ metadata: DiscussionMediaDraft; photoPreview?: Blob }> {
  if (import.meta.env.VITE_DISCUSSION_PHOTO_VARIANTS_ENABLED !== 'true') {
    return { metadata: { ...metadata, storageKey: await photoMediaKey(metadata.storageKey, accountId) } };
  }
  const photoId = DISCUSSION_MEDIA_KEY_PATTERN.exec(metadata.storageKey)?.[3];
  if (!photoId) throw new Error('Не удалось подготовить ключ фотографии.');
  const prefix = `mvp-media/${await discussionMediaSenderPrefix(accountId)}`;
  const photoPreview = await createDiscussionPhotoPreview(file, signal);
  return { metadata: { ...metadata, id: photoId, storageKey: `${prefix}/full/${photoId}`,
    preview: { storageKey: `${prefix}/preview/${photoId}`, mimeType: photoPreview.type, sizeBytes: photoPreview.size } },
    photoPreview };
}
