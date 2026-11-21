import type { MezfitCloudDatabase } from './database';
import { discussionId, discussionRecord } from '../../../shared/discussion-anchor';
import { isDiscussionMediaPair, isVoiceWaveform, type DiscussionPhotoPreview } from '../../../shared/discussion-attachment';
import { DISCUSSION_MEDIA_KEY_PATTERN, discussionMediaSenderPrefix } from '../../../shared/discussion-media-limits';
import { directMediaSizeLimit, directMediaUrl, MEDIA_FILE_ACCEPT } from '../../media/directMediaUpload';

const galleryTypes = new Set(MEDIA_FILE_ACCEPT.split(',')
  .filter(type => type.startsWith('image/') || type.startsWith('video/')));
export const DISCUSSION_MEDIA_ACCEPT = [...galleryTypes].join(',');

export function isDiscussionMediaType(type: string): boolean {
  return galleryTypes.has(type) || (typeof type === 'string' && type.startsWith('audio/') && directMediaSizeLimit(type) > 0);
}

export interface DiscussionMediaDraft {
  id: string;
  storageKey: string;
  mediaType: 'photo' | 'video' | 'video-note' | 'voice';
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number | null;
  waveform?: number[];
  preview?: DiscussionPhotoPreview;
  fileName: string;
  uploadState: 'uploading' | 'failed';
}

export function isDiscussionMediaDraft(value: unknown): value is DiscussionMediaDraft {
  if (!discussionRecord(value) || !discussionId(value.id)
    || typeof value.storageKey !== 'string' || !directMediaUrl(value.storageKey)
    || typeof value.mimeType !== 'string' || !isDiscussionMediaType(value.mimeType)
    || typeof value.sizeBytes !== 'number' || !Number.isSafeInteger(value.sizeBytes) || value.sizeBytes <= 0 || value.sizeBytes > directMediaSizeLimit(value.mimeType)
    || typeof value.fileName !== 'string' || value.fileName.length > 1024
    || (value.uploadState !== 'uploading' && value.uploadState !== 'failed')) return false;
  if ((value.preview !== undefined || DISCUSSION_MEDIA_KEY_PATTERN.exec(value.storageKey)?.[2])
    && !isDiscussionMediaPair(value, value.preview)) return false;
  if (value.mediaType === 'voice') return value.mimeType.startsWith('audio/')
    && typeof value.durationSeconds === 'number' && Number.isFinite(value.durationSeconds) && value.durationSeconds > 0
    && isVoiceWaveform(value.waveform);
  if (value.waveform !== undefined) return false;
  if (value.mediaType === 'photo') return value.mimeType.startsWith('image/') && value.durationSeconds === null;
  return (value.mediaType === 'video' || value.mediaType === 'video-note') && value.mimeType.startsWith('video/')
    && typeof value.durationSeconds === 'number' && value.durationSeconds > 0
    && value.durationSeconds <= (value.mediaType === 'video-note' ? 60 : 180);
}

export function sameDiscussionPhotoPreview(a?: DiscussionPhotoPreview, b?: DiscussionPhotoPreview): boolean {
  return a?.storageKey === b?.storageKey && a?.mimeType === b?.mimeType && a?.sizeBytes === b?.sizeBytes;
}

export async function belongsToDiscussionPhotoSender(draft: DiscussionMediaDraft, actorUserId: string): Promise<boolean> {
  return !draft.preview || DISCUSSION_MEDIA_KEY_PATTERN.exec(draft.storageKey)?.[1] === await discussionMediaSenderPrefix(actorUserId);
}

/** The text sent with a gallery upload has one identity across retries and devices. */
export function discussionMediaTextId(attachment: DiscussionMediaDraft): string {
  return 'gallery-text:' + attachment.storageKey;
}

/** Consult the already-committed attachment when recovering the local photo outbox. */
export async function isLocallyPublishedDiscussionPhoto(
  db: Pick<MezfitCloudDatabase, 'messageAttachments'>, actorUserId: string, storageKey: string,
): Promise<boolean> {
  const key = DISCUSSION_MEDIA_KEY_PATTERN.exec(storageKey);
  if (key?.[2] !== 'full') return false;
  const attachment = await db.messageAttachments?.get(key[3]);
  return !!attachment && attachment.owner === actorUserId && attachment.authorUserId === actorUserId
    && attachment.storageKey === storageKey && attachment.uploadState === 'ready'
    && isDiscussionMediaPair({ ...attachment }, attachment.preview);
}
