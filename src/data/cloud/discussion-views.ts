import { discussionId, discussionRecord } from '../../../shared/discussion-anchor';
import type { DiscussionMessage } from './discussion-contracts';
export interface DiscussionCursor { createdAt: string; id: string }
export interface DiscussionQuote { messageId: string; authorUserId: string | null; text: string; unavailable: boolean; deleted: boolean }
/** Evidence captured by the repository, never inferred from its general sync indicator. */
export interface DiscussionReceiptSnapshot {
  confirmedIds: readonly string[];
  recipientReadThrough: readonly DiscussionCursor[];
}
export interface DiscussionMessageView {
  id: string; threadId: string; authorUserId: string; createdAt: string;
  text: string; deleted: boolean; editedAt?: string; reply: DiscussionQuote | null;
}
export const discussionInstant = (value: unknown): value is string => typeof value === 'string'
  && value.length === 24 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export const discussionCursorKey = (cursor: DiscussionCursor): string => cursor.createdAt + '/' + cursor.id;
export function discussionCursorFromKey(value: unknown): DiscussionCursor | null {
  if (typeof value !== 'string' || value[24] !== '/' || !discussionInstant(value.slice(0, 24)) || !discussionId(value.slice(25))) return null;
  return { createdAt: value.slice(0, 24), id: value.slice(25) };
}
export function isDiscussionMessage(value: unknown): value is DiscussionMessage {
  return discussionRecord(value) && discussionId(value.id) && discussionId(value.realmId)
    && discussionId(value.threadId) && typeof value.authorUserId === 'string' && /^tg:[1-9]\d*$/.test(value.authorUserId)
    && value.owner === value.authorUserId && typeof value.text === 'string' && value.text.length <= 20000
    && discussionInstant(value.createdAt) && (value.editedAt === undefined || discussionInstant(value.editedAt))
    && (value.deletedAt === undefined || value.deletedAt === '' || discussionInstant(value.deletedAt))
    && (value.replyToMessageId === undefined || (discussionId(value.replyToMessageId) && value.replyToMessageId !== value.id))
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
      unavailable: !source, deleted: Boolean(source?.deletedAt),
    } };
}
