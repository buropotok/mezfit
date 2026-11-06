import { discussionId, discussionRecord } from './discussion-anchor';

/** Metadata only. Native owner has full row control; these guards describe normal app writes. */
export interface MessageAttachment {
  id: string; realmId: string; owner: string; authorUserId: string; messageId: string;
  mediaType: 'photo' | 'video' | 'voice'; storageKey: string | null;
  mimeType: string; sizeBytes: number; durationSeconds: number | null;
  uploadState: 'pending' | 'uploading' | 'failed' | 'ready';
  confirmedAt: string | null;
  deletedAt?: string;
}

/** Response from the future authenticated gateway after it verifies the actual stored object.
 * This DTO is not a signed capability or an ACL proof when copied into Dexie by its owner.
 */
export interface AttachmentUploadConfirmation {
  attachmentId: string; realmId: string; messageId: string; authorUserId: string;
  mediaType: MessageAttachment['mediaType']; storageKey: string;
  mimeType: string; sizeBytes: number; durationSeconds: number | null; confirmedAt: string;
}
interface AttachmentThread { id: string; realmId: string }
interface AttachmentMessage {
  id: string; realmId: string; threadId: string; owner: string; authorUserId: string; deletedAt?: string;
}
function invalid(): never { throw new Error('INVALID_DISCUSSION_ATTACHMENT'); }
const actorId = (value: unknown): value is string => typeof value === 'string' && /^tg:[1-9]\d*$/.test(value);
const instant = (value: unknown): value is string => typeof value === 'string'
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
// An object identity, never an access URL. It conveys no storage permission.
const storageKey = (value: unknown): value is string => typeof value === 'string'
  && value.length > 0 && value.length <= 1024 && !/[\s\u0000-\u001f?#]/.test(value)
  && !value.includes('://') && !value.startsWith('/') && !value.split('/').some(part => part === '..' || part === '.');
function media(value: Record<string, unknown>): boolean {
  if (typeof value.mimeType !== 'string' || value.mimeType.length > 256
    || !Number.isSafeInteger(value.sizeBytes) || Number(value.sizeBytes) <= 0) return false;
  const prefix = value.mediaType === 'photo' ? 'image/' : value.mediaType === 'video' ? 'video/' : value.mediaType === 'voice' ? 'audio/' : null;
  if (!prefix || !value.mimeType.startsWith(prefix) || value.mimeType.length === prefix.length
    || /[\r\n\u0000]/.test(value.mimeType)) return false;
  if (value.mediaType === 'photo') return value.durationSeconds === null;
  return typeof value.durationSeconds === 'number' && Number.isFinite(value.durationSeconds)
    && value.durationSeconds > 0 && (value.mediaType !== 'video' || value.durationSeconds <= 180);
}
export function isAttachmentUploadConfirmation(value: unknown): value is AttachmentUploadConfirmation {
  return discussionRecord(value) && discussionId(value.attachmentId) && discussionId(value.realmId)
    && discussionId(value.messageId) && actorId(value.authorUserId) && media(value)
    && storageKey(value.storageKey) && instant(value.confirmedAt);
}

/** Membership is established by the repository's existing realm context, not by this pure guard. */
export function assertMessageAttachmentWrite(
  actor: string, thread: AttachmentThread, message: AttachmentMessage,
  attachment: MessageAttachment, previous?: MessageAttachment,
): void {
  if (!actorId(actor) || !discussionId(thread.id) || !discussionId(thread.realmId)
    || message.threadId !== thread.id || message.realmId !== thread.realmId
    || message.authorUserId !== actor || message.owner !== actor
    || !discussionId(attachment.id) || attachment.messageId !== message.id || !discussionId(message.id)
    || attachment.realmId !== thread.realmId || attachment.owner !== actor || attachment.authorUserId !== actor
    || !media({ ...attachment }) || (attachment.storageKey !== null && !storageKey(attachment.storageKey))
    || !['pending', 'uploading', 'failed', 'ready'].includes(attachment.uploadState)
    || (attachment.deletedAt !== undefined && !instant(attachment.deletedAt))
    || (message.deletedAt !== undefined && attachment.deletedAt === undefined)) invalid();
  if (attachment.uploadState === 'ready') {
    if (!storageKey(attachment.storageKey) || !instant(attachment.confirmedAt)) invalid();
  } else if (attachment.confirmedAt !== null) invalid();
  if (previous) {
    for (const field of ['id', 'realmId', 'owner', 'authorUserId', 'messageId', 'mediaType', 'mimeType', 'sizeBytes', 'durationSeconds'] as const)
      if (previous[field] !== attachment[field]) invalid();
    if ((previous.storageKey !== null && previous.storageKey !== attachment.storageKey)
      || (previous.confirmedAt !== null && previous.confirmedAt !== attachment.confirmedAt)
      || (previous.uploadState === 'ready' && attachment.uploadState !== 'ready')
      || (previous.deletedAt !== undefined && previous.deletedAt !== attachment.deletedAt)) invalid();
  }
}

/** Call only with a response from the authenticated gateway, never a local 'ready' flag.
 * Gateway must authorize this identity and inspect storage independently on confirm/read/remove.
 */
export function applyAttachmentUploadConfirmation(
  actor: string, thread: AttachmentThread, message: AttachmentMessage,
  attachment: MessageAttachment, response: unknown,
): MessageAttachment {
  assertMessageAttachmentWrite(actor, thread, message, attachment);
  if (attachment.deletedAt !== undefined || !isAttachmentUploadConfirmation(response)
    || response.attachmentId !== attachment.id || response.realmId !== attachment.realmId
    || response.messageId !== attachment.messageId || response.authorUserId !== actor
    || response.mediaType !== attachment.mediaType || response.mimeType !== attachment.mimeType
    || response.sizeBytes !== attachment.sizeBytes || response.durationSeconds !== attachment.durationSeconds
    || (attachment.storageKey !== null && response.storageKey !== attachment.storageKey)) invalid();
  const confirmed: MessageAttachment = { ...attachment, storageKey: response.storageKey,
    uploadState: 'ready', confirmedAt: attachment.confirmedAt ?? response.confirmedAt };
  assertMessageAttachmentWrite(actor, thread, message, confirmed, attachment);
  return confirmed;
}
