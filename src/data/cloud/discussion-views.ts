import { discussionId, discussionRecord } from '../../../shared/discussion-anchor';
import { isDiscussionVideoPosition, type DiscussionMessage, type DiscussionVideoPosition, type MessageAttachment } from './discussion-contracts';
import { discussionInstant, type DiscussionCursor } from '../../../shared/discussion-read-state';
export { discussionInstant, discussionCursorKey, discussionCursorFromKey, discussionReadCursor, type DiscussionCursor } from '../../../shared/discussion-read-state';
export interface DiscussionQuote { messageId: string; authorUserId: string | null; text: string; unavailable: boolean; deleted: boolean; videoPosition?: DiscussionVideoPosition }
/** Evidence captured by the repository, never inferred from its general sync indicator. */
export interface DiscussionReceiptSnapshot {
  confirmedIds: readonly string[];
  recipientReadThrough: readonly (DiscussionCursor & { threadId?: string })[];
}
export interface DiscussionMessageView {
  id: string; threadId: string; authorUserId: string; createdAt: string;
  attachments?: readonly MessageAttachment[];
  text: string; deleted: boolean; editedAt?: string; reply: DiscussionQuote | null;
}
export function isDiscussionMessage(value: unknown): value is DiscussionMessage {
  return discussionRecord(value) && discussionId(value.id) && discussionId(value.realmId)
    && discussionId(value.threadId) && typeof value.authorUserId === 'string' && /^tg:[1-9]\d*$/.test(value.authorUserId)
    && value.owner === value.authorUserId && typeof value.text === 'string' && value.text.length <= 20000
    && discussionInstant(value.createdAt) && (value.editedAt === undefined || discussionInstant(value.editedAt))
    && (value.deletedAt === undefined || value.deletedAt === '' || discussionInstant(value.deletedAt))
    && (value.replyToMessageId === undefined || (discussionId(value.replyToMessageId) && value.replyToMessageId !== value.id))
    && (value.replyVideoPosition === undefined || (discussionId(value.replyToMessageId) && isDiscussionVideoPosition(value.replyVideoPosition)))
    && (value.draftForRealmId === undefined || discussionId(value.draftForRealmId));
}
/** Mask residual text from an edit/delete merge, including in dynamic quotes. */
export function discussionMessageView(row: DiscussionMessage, original?: DiscussionMessage): DiscussionMessageView {
  const source = original && isDiscussionMessage(original) && !original.draftForRealmId
    && original.id === row.replyToMessageId && original.realmId === row.realmId && original.threadId === row.threadId ? original : undefined;
  const deleted = Boolean(row.deletedAt);
  return { id: row.id, threadId: row.threadId, authorUserId: row.authorUserId, createdAt: row.createdAt,
    text: deleted ? '' : row.text, deleted, editedAt: deleted ? undefined : row.editedAt,
    reply: deleted || !row.replyToMessageId ? null : {
      messageId: row.replyToMessageId, authorUserId: source?.authorUserId ?? null,
      text: source && !source.deletedAt ? source.text.split(/\r?\n/, 1)[0].slice(0, 160) : '',
      ...(row.replyVideoPosition ? { videoPosition: row.replyVideoPosition } : {}),
      unavailable: !source, deleted: Boolean(source?.deletedAt),
    } };
}
