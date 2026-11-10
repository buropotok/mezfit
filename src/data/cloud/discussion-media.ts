import { discussionId, discussionRecord } from '../../../shared/discussion-anchor';
import { isVoiceWaveform } from '../../../shared/discussion-attachment';
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
  mediaType: 'photo' | 'video' | 'voice';
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number | null;
  waveform?: number[];
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
  if (value.mediaType === 'voice') return value.mimeType.startsWith('audio/')
    && typeof value.durationSeconds === 'number' && Number.isFinite(value.durationSeconds) && value.durationSeconds > 0
    && isVoiceWaveform(value.waveform);
  if (value.waveform !== undefined) return false;
  if (value.mediaType === 'photo') return value.mimeType.startsWith('image/') && value.durationSeconds === null;
  return value.mediaType === 'video' && value.mimeType.startsWith('video/') && typeof value.durationSeconds === 'number'
    && value.durationSeconds > 0 && value.durationSeconds <= 180;
}

/** The text sent with a gallery upload has one identity across retries and devices. */
export function discussionMediaTextId(attachment: DiscussionMediaDraft): string {
  return 'gallery-text:' + attachment.storageKey;
}
