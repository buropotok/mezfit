/** Shared limits for the direct Yandex and R2 discussion-media transports. */
export const DISCUSSION_MEDIA_LIMITS_MIB: Readonly<Record<string, number>> = {
  'image/jpeg': 20, 'image/png': 20, 'image/webp': 20, 'image/gif': 20, 'image/heic': 20,
  'video/mp4': 250, 'video/webm': 250, 'video/quicktime': 250,
  'audio/ogg': 25, 'audio/webm': 25, 'audio/mp4': 25, 'audio/mpeg': 25, 'audio/wav': 25,
};

// Capture sender, photo variant and object ID. The sender and variant are
// optional for legacy keys, but a variant always requires a sender.
export const DISCUSSION_MEDIA_KEY_PATTERN = /^mvp-media\/(?:([a-f0-9]{64})\/(?:(preview|full)\/)?)?([a-f0-9]{64})$/;
export const DISCUSSION_PHOTO_PREVIEW_MAX_BYTES = 100 * 1024;

/** Use an opaque path segment so public media URLs omit raw Telegram IDs. */
export async function discussionMediaSenderPrefix(actorUserId: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(actorUserId));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function discussionMediaSizeLimit(mimeType: string): number {
  // Only explicitly supported MIME keys are valid. Prototype properties like
  // "constructor" and "toString" must never count as supported file types.
  const own = Object.prototype.hasOwnProperty.call(DISCUSSION_MEDIA_LIMITS_MIB, mimeType);
  return own ? DISCUSSION_MEDIA_LIMITS_MIB[mimeType] * 1024 * 1024 : 0;
}

export function discussionMediaObjectSizeLimit(storageKey: string, mimeType: string): number {
  const key = DISCUSSION_MEDIA_KEY_PATTERN.exec(storageKey);
  if (!key) return 0;
  if (key[2] === 'preview') {
    return mimeType === 'image/webp' || mimeType === 'image/jpeg' ? DISCUSSION_PHOTO_PREVIEW_MAX_BYTES : 0;
  }
  if (key[2] === 'full' && !mimeType.startsWith('image/')) return 0;
  return discussionMediaSizeLimit(mimeType);
}
