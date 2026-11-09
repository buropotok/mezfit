import { discussionId, discussionRecord } from '../../../shared/discussion-anchor';
import { directMediaSizeLimit, directMediaUrl, MEDIA_FILE_ACCEPT } from '../../media/directMediaUpload';

const galleryTypes = new Set(MEDIA_FILE_ACCEPT.split(',')
  .filter(type => type.startsWith('image/') || type.startsWith('video/')));
export const DISCUSSION_MEDIA_ACCEPT = [...galleryTypes].join(',');

export function isDiscussionMediaType(type: string): boolean {
  return galleryTypes.has(type);
}

export interface DiscussionMediaDraft {
  id: string;
  storageKey: string;
  mediaType: 'photo' | 'video';
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number | null;
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
  if (value.mediaType === 'photo') return value.mimeType.startsWith('image/') && value.durationSeconds === null;
  return value.mediaType === 'video' && value.mimeType.startsWith('video/') && typeof value.durationSeconds === 'number'
    && value.durationSeconds > 0 && value.durationSeconds <= 180;
}
