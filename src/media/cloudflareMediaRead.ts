import { requestDiscussionR2ReadUrl } from '../api';
import { getTelegramWebApp } from '../telegram';
import { DISCUSSION_MEDIA_KEY_PATTERN, discussionMediaSizeLimit } from '../../shared/discussion-media-limits';
import type { DiscussionMediaCacheEntry } from './discussionMediaCache';

const R2_READ_HOST = /^mezfit-discussion-media\.[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/i;

/** Browser playback uses this URL directly, including native HTTP Range requests.
 * A private capability is returned only after Worker checks Dexie Cloud membership.
 */
export async function signedDiscussionR2ReadUrl(
  entry: DiscussionMediaCacheEntry, signal?: AbortSignal,
): Promise<string> {
  const { realmId, messageId, attachmentId, storageKey, mimeType, sizeBytes } = entry;
  if (!realmId || !messageId || !attachmentId || !DISCUSSION_MEDIA_KEY_PATTERN.test(storageKey)
    || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0
    || sizeBytes > discussionMediaSizeLimit(mimeType)) throw new Error('R2_READ_INVALID_MEDIA');
  const initData = getTelegramWebApp()?.initData;
  if (!initData) throw new Error('R2_READ_AUTH_REQUIRED');
  const result = await requestDiscussionR2ReadUrl({
    initData, realmId, messageId, attachmentId,
    storageKey, contentType: mimeType, sizeBytes,
  }, signal);
  if (result.expiresAt <= Date.now() + 5_000) throw new Error('R2_READ_EXPIRED');
  const url = new URL(result.getUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash
    || !R2_READ_HOST.test(url.host) || url.pathname !== '/' + storageKey
    || url.searchParams.get('X-Amz-Algorithm') !== 'AWS4-HMAC-SHA256'
    || url.searchParams.get('X-Amz-SignedHeaders') !== 'host'
    || !/^[a-f0-9]{64}$/.test(url.searchParams.get('X-Amz-Signature') ?? '')) {
    throw new Error('R2_READ_INVALID_URL');
  }
  return result.getUrl;
}
