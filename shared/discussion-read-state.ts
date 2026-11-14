import { discussionId, discussionRecord } from './discussion-anchor';

const actorId = (value: string) => /^tg:[1-9]\d*$/.test(value);

export interface DiscussionCursor { createdAt: string; id: string }

export function discussionReadStateId(realmId: string, threadId: string, userId: string): string {
  if (!discussionId(realmId) || !discussionId(threadId) || !actorId(userId)) throw new Error('INVALID_DISCUSSION_WRITE');
  // Addon 4.4.15 decodes server keys starting with '[' as compound-key arrays.
  // A non-reserved prefix keeps this string stable across push/pull.
  return 'discussion-read:' + JSON.stringify([realmId, threadId, userId]);
}
/** Exact compatibility for old JSON-string IDs and the Addon's decoded array form. */
export function matchesDiscussionReadStateId(value: unknown, realmId: string, threadId: string, userId: string): boolean {
  if (!discussionId(realmId) || !discussionId(threadId) || !actorId(userId)) return false;
  const legacy = ['discussion-read', realmId, threadId, userId];
  return value === discussionReadStateId(realmId, threadId, userId) || value === JSON.stringify(legacy)
    || (Array.isArray(value) && value.length === legacy.length && legacy.every((part, index) => value[index] === part));
}
export const discussionInstant = (value: unknown): value is string => typeof value === 'string'
  && value.length === 24 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export const discussionCursorKey = (cursor: DiscussionCursor): string => cursor.createdAt + '/' + cursor.id;
export function discussionCursorFromKey(value: unknown): DiscussionCursor | null {
  if (typeof value !== 'string' || value[24] !== '/' || !discussionInstant(value.slice(0, 24)) || !discussionId(value.slice(25))) return null;
  return { createdAt: value.slice(0, 24), id: value.slice(25) };
}
/** Validate received records, including old keys decoded by the Addon; never relax owner/scope/cursor checks. */
export function discussionReadCursor(value: unknown, realmId: string, threadId: string, userId: string): DiscussionCursor | null {
  if (!discussionRecord(value) || value.realmId !== realmId || value.threadId !== threadId
    || value.userId !== userId || value.owner !== userId
    || !matchesDiscussionReadStateId(value.id, realmId, threadId, userId)) return null;
  const cursor = discussionCursorFromKey(value.readThrough);
  return cursor && cursor.id === value.lastReadMessageId ? cursor : null;
}
