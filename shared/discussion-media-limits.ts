/** Shared limits for the direct Yandex and R2 discussion-media transports. */
export const DISCUSSION_MEDIA_LIMITS_MIB: Readonly<Record<string, number>> = {
  'image/jpeg': 20, 'image/png': 20, 'image/webp': 20, 'image/gif': 20, 'image/heic': 20,
  'video/mp4': 250, 'video/webm': 250, 'video/quicktime': 250,
  'audio/ogg': 25, 'audio/webm': 25, 'audio/mp4': 25, 'audio/mpeg': 25, 'audio/wav': 25,
};

export const DISCUSSION_MEDIA_KEY_PATTERN = /^mvp-media\/[a-f0-9]{64}$/;

export function discussionMediaSizeLimit(mimeType: string): number {
  return (DISCUSSION_MEDIA_LIMITS_MIB[mimeType] ?? 0) * 1024 * 1024;
}
