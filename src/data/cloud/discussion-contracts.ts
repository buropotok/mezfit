import { discussionAnchorKey, discussionId, discussionParents, type DiscussionAnchor, type DiscussionScope } from '../../../shared/discussion-anchor';
export type { DiscussionAnchor, DiscussionScope } from '../../../shared/discussion-anchor';
export const DISCUSSION_STORES = {
  discussionThreads: 'id, realmId, [realmId+coachClientId], [realmId+anchorKey], [realmId+lastActivityAt]',
  discussionMessages: 'id, realmId, [realmId+threadId], [realmId+threadId+createdAt], [realmId+authorUserId]',
  discussionReadStates: 'id, realmId, [realmId+threadId+userId]',
  messageAttachments: 'id, realmId, [realmId+messageId]',
} as const;
export interface DiscussionThread extends DiscussionScope {
  id: string;
  /** Realm sentinel; domain keeps anchor immutable. No extra ACL per entity. */
  owner: string;
  anchor: DiscussionAnchor;
  anchorKey: string;
  contextPath: DiscussionAnchor[];
  derivedTitleSnapshot: string;
  createdAt: string;
  lastActivityAt: string;
}
export interface DiscussionMessage {
  id: string; realmId: string; owner: string; threadId: string; authorUserId: string;
  text: string; replyToMessageId?: string; createdAt: string; editedAt?: string; deletedAt?: string;
}
export interface DiscussionReadState {
  id: string; realmId: string; owner: string; threadId: string; userId: string;
  lastReadMessageId: string | null; lastReadAt: string;
}
export { assertMessageAttachmentWrite, applyAttachmentUploadConfirmation, isAttachmentUploadConfirmation,
  type MessageAttachment, type AttachmentUploadConfirmation } from '../../../shared/discussion-attachment';
const instant = (value: string) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const actorId = (value: string) => /^tg:[1-9]\d*$/.test(value);
const invalid = (): never => { throw new Error('INVALID_DISCUSSION_WRITE'); };
export function discussionReadStateId(realmId: string, threadId: string, userId: string): string {
  if (!discussionId(realmId) || !discussionId(threadId) || !actorId(userId)) invalid();
  return JSON.stringify(['discussion-read', realmId, threadId, userId]);
}
/** Domain contract, not a claim that owner provenance is frozen by the cloud. */
export function assertDiscussionThread(thread: DiscussionThread): void {
  if (!Array.isArray(thread.contextPath) || typeof thread.derivedTitleSnapshot !== 'string'
    || !discussionId(thread.id) || thread.owner !== thread.realmId
    || thread.anchorKey !== discussionAnchorKey(thread, thread.anchor)
    || JSON.stringify(thread.contextPath.map(parent => discussionAnchorKey(thread, parent)))
      !== JSON.stringify(discussionParents(thread.anchor).map(parent => discussionAnchorKey(thread, parent)))
    || !thread.derivedTitleSnapshot.trim() || !instant(thread.createdAt) || !instant(thread.lastActivityAt)) invalid();
}
/** Callers establish membership using the existing realm boundary, not anchor-specific grants. */
export function assertDiscussionMessageWrite(
  actor: string, thread: DiscussionThread, message: DiscussionMessage,
  previous?: DiscussionMessage, reply?: DiscussionMessage,
): void {
  assertDiscussionThread(thread);
  if (!actorId(actor) || !discussionId(message.id) || message.realmId !== thread.realmId
    || message.threadId !== thread.id || message.owner !== actor || message.authorUserId !== actor
    || typeof message.text !== 'string' || message.text.length > 20000 || !instant(message.createdAt)
    || (message.editedAt !== undefined && !instant(message.editedAt))
    || (message.deletedAt !== undefined && (!instant(message.deletedAt) || message.text !== ''))) invalid();
  if (previous && (previous.owner !== actor || previous.authorUserId !== actor
    || previous.id !== message.id || previous.realmId !== message.realmId || previous.threadId !== message.threadId
    || previous.createdAt !== message.createdAt || previous.replyToMessageId !== message.replyToMessageId
    || (previous.deletedAt !== undefined && previous.deletedAt !== message.deletedAt))) invalid();
  if (message.replyToMessageId !== undefined && (!discussionId(message.replyToMessageId)
    || message.replyToMessageId === message.id || !reply || reply.id !== message.replyToMessageId
    || reply.threadId !== thread.id || reply.realmId !== thread.realmId)) invalid();
}
export function assertDiscussionReadStateWrite(
  actor: string, thread: DiscussionThread, state: DiscussionReadState, lastRead?: DiscussionMessage,
): void {
  assertDiscussionThread(thread);
  if (state.realmId !== thread.realmId || state.threadId !== thread.id || state.userId !== actor || state.owner !== actor
    || state.id !== discussionReadStateId(thread.realmId, thread.id, actor) || !instant(state.lastReadAt)
    || (state.lastReadMessageId !== null && (!lastRead || state.lastReadMessageId !== lastRead.id
      || lastRead.realmId !== thread.realmId || lastRead.threadId !== thread.id))) invalid();
}
