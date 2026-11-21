import { discussionAnchorKey, discussionId, discussionRecord, isDiscussionAnchor, isPersonalDiscussionId, isPersonalDiscussionRealm,
  matchesDiscussionThreadAnchor, personalDiscussionId } from '../../shared/discussion-anchor';
import { DISCUSSION_MEDIA_KEY_PATTERN, discussionMediaSenderPrefix } from '../../shared/discussion-media-limits';
import { isDiscussionMediaPair } from '../../shared/discussion-attachment';
import { cloudList, cloudRead, cloudToken, readNotificationRelationship, type WorkoutReminderEnv } from './workout-reminders';

const mediaRowId = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** Only the dedicated read-only Dexie service account may verify a media viewer. */
export type DiscussionMediaReadEnv = Pick<WorkoutReminderEnv,
  'DEXIE_CLOUD_REMINDER_CLIENT_ID' | 'DEXIE_CLOUD_REMINDER_CLIENT_SECRET'>;

export interface DiscussionR2ReadIdentity {
  realmId: string;
  messageId: string;
  attachmentId: string;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
}

export function validDiscussionR2ReadIdentity(value: unknown): value is DiscussionR2ReadIdentity {
  if (!discussionRecord(value) || typeof value.storageKey !== 'string') return false;
  const key = DISCUSSION_MEDIA_KEY_PATTERN.exec(value.storageKey);
  if (!key) return false;
  return (isPersonalDiscussionRealm(value.realmId) || (typeof value.realmId === 'string' && /^rlm[a-f0-9]{28}$/.test(value.realmId)))
    && mediaRowId(value.messageId) && (key[2] ? value.attachmentId === key[3] : mediaRowId(value.attachmentId))
    && typeof value.contentType === 'string'
    && typeof value.sizeBytes === 'number' && Number.isSafeInteger(value.sizeBytes);
}

/**
 * Telegram identity alone never grants R2 read. Require an accepted coach/client
 * relationship or ownership of the personal realm, plus the exact ready attachment.
 * Never trust the realm/attachment IDs supplied by the requesting browser.
 */
export async function authorizeDiscussionR2Read(
  env: DiscussionMediaReadEnv, actorId: string, input: DiscussionR2ReadIdentity,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const personal = isPersonalDiscussionRealm(input.realmId);
  if (personal && input.realmId !== actorId) return false;
  const token = await cloudToken(env, fetchImpl);
  const authors = [actorId];
  if (!personal) {
    const realm = encodeURIComponent(input.realmId);
    const members = await cloudList('/all/members?realmId=' + realm, token, fetchImpl);
    const coach = members.find(member => discussionRecord(member) && member.realmId === input.realmId
      && Array.isArray(member.roles) && member.roles.includes('coach'));
    const client = members.find(member => discussionRecord(member) && member.realmId === input.realmId
      && Array.isArray(member.roles) && member.roles.includes('client'));
    if (!discussionRecord(coach) || !discussionRecord(client)
      || typeof coach.userId !== 'string' || typeof client.userId !== 'string'
      || (actorId !== coach.userId && actorId !== client.userId)) return false;
    if (!await readNotificationRelationship({
      realmId: input.realmId, coachUserId: coach.userId, clientUserId: client.userId,
    }, token, fetchImpl, members)) return false;
    authors.push(coach.userId, client.userId);
  }

  const [message, attachment] = await Promise.all([
    cloudRead('/all/discussionMessages/' + encodeURIComponent(input.messageId), token, fetchImpl, true),
    cloudRead('/all/messageAttachments/' + encodeURIComponent(input.attachmentId), token, fetchImpl, true),
  ]);
  if (!discussionRecord(message) || message.id !== input.messageId
    || message.realmId !== input.realmId || !discussionId(message.threadId)
    || typeof message.authorUserId !== 'string' || message.owner !== message.authorUserId
    || message.deletedAt || message.draftForRealmId
    || !authors.includes(message.authorUserId)
    || (personal ? message.threadId !== personalDiscussionId(actorId) : isPersonalDiscussionId(message.threadId))
    || !discussionRecord(attachment) || attachment.id !== input.attachmentId
    || attachment.messageId !== input.messageId || attachment.realmId !== input.realmId
    || attachment.owner !== message.authorUserId || attachment.authorUserId !== message.authorUserId
    || attachment.deletedAt || attachment.uploadState !== 'ready') return false;
  const key = DISCUSSION_MEDIA_KEY_PATTERN.exec(input.storageKey);
  if (!key) return false;
  let object = attachment;
  if (key[2] || attachment.preview !== undefined) {
    const preview = attachment.preview;
    if (!key[2] || !isDiscussionMediaPair(attachment, preview)) return false;
    if (key[2] === 'preview') object = { ...preview };
  }
  if (object.storageKey !== input.storageKey || object.mimeType !== input.contentType
    || object.sizeBytes !== input.sizeBytes) return false;
  const senderPrefix = key[1];
  if (senderPrefix && senderPrefix !== await discussionMediaSenderPrefix(message.authorUserId)) return false;
  const thread = await cloudRead('/all/discussionThreads/' + encodeURIComponent(message.threadId), token, fetchImpl, true);
  if (!discussionRecord(thread) || thread.id !== message.threadId
    || thread.realmId !== input.realmId || thread.owner !== input.realmId) return false;
  if (!personal) return thread.coachClientId === input.realmId;
  return thread.coachClientId === null && isDiscussionAnchor(thread.anchor) && thread.anchor.kind === 'free'
    && matchesDiscussionThreadAnchor(thread.anchor, message.threadId, thread.derivedTitleSnapshot, thread.contextPath)
    && thread.anchorKey === discussionAnchorKey({ realmId: actorId, coachClientId: null }, thread.anchor);
}
