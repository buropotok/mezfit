import { discussionAnchorKey, discussionId, discussionRecord as record, isDiscussionAnchor } from '../../shared/discussion-anchor';
import { discussionCursorKey, discussionInstant, discussionReadCursor, discussionReadStateId } from '../../shared/discussion-read-state';
import { validatedTelegramId } from '../../shared/approved-relationship';
import { sendTopicTelegram } from './coach-telegram';
import { cloudList, cloudRead, cloudToken, enabledByPreference, readNotificationClientName, readNotificationRelationship, type WorkoutReminderEnv } from './workout-reminders';

type DiscussionNotificationEnv = WorkoutReminderEnv;

const READ_GRACE_MS = 2_000;
const webhookPath = '/api/webhooks/dexie-discussions';
const realmKey = (value: unknown): value is string => typeof value === 'string' && /^rlm[a-f0-9]{28}$/.test(value);
const cloudPath = (table: string, id: string) => '/all/' + table + '/' + encodeURIComponent(id);

export async function receiveDiscussionNotifications(
  request: Request, env: DiscussionNotificationEnv, ctx?: Pick<ExecutionContext, 'waitUntil'>,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== webhookPath) return null;
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  const configured = env.DEXIE_DISCUSSION_WEBHOOK_SECRET;
  const provided = request.headers.get('X-DexieCloud-Token');
  if (!configured || !provided || provided.length > 512) return new Response(null, { status: 403 });
  const hashes = await Promise.all([configured, provided].map(value =>
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
  const a = new Uint8Array(hashes[0]);
  const b = new Uint8Array(hashes[1]);
  if (a.reduce((difference, byte, index) => difference | (byte ^ b[index]), 0) !== 0) {
    return new Response(null, { status: 403 });
  }
  const data: unknown = await request.json().catch(() => null);
  if (!record(data) || !Array.isArray(data.changes)) return new Response(null, { status: 400 });
  const events = new Map<string, { id: string; realmId: string }>();
  for (const change of data.changes) {
    if (!record(change) || change.table !== 'discussionMessages' || !discussionId(change.key)) continue;
    const realmId = change.type === 'upsert' && record(change.value) ? change.value.realmId
      : change.type === 'update' && record(change.updates) && Object.hasOwn(change.updates, 'realmId')
        ? change.updates.realmId : undefined;
    if (!realmKey(realmId)) continue;
    events.set(JSON.stringify([change.key, realmId]), { id: change.key, realmId });
  }
  if (!events.size) return new Response(null, { status: 204 });

  await new Promise(resolve => setTimeout(resolve, READ_GRACE_MS));
  const token = env.DEXIE_CLOUD_REMINDER_CLIENT_ID && env.DEXIE_CLOUD_REMINDER_CLIENT_SECRET
    ? await cloudToken(env, fetch).catch(() => null) : null;
  const statements: D1PreparedStatement[] = [];
  const candidates = [...events.values()];
  try {
    for (let index = 0; index < candidates.length; index += 3) {
      const unread = await Promise.all(candidates.slice(index, index + 3).map(async event => {
        // Keep an event for retry if Dexie is temporarily unavailable.
        return !token || !await publicationAlreadyRead(event.id, event.realmId, token).catch(() => false);
      }));
      for (const [offset, shouldEnqueue] of unread.entries()) {
        if (!shouldEnqueue) continue;
        const event = candidates[index + offset];
        statements.push(env.DB_BINDING.prepare(
          'INSERT OR IGNORE INTO telegram_discussion_delivery (message_id, realm_id) VALUES (?, ?)',
        ).bind(event.id, event.realmId));
      }
    }
    for (let index = 0; index < statements.length; index += 50) {
      await env.DB_BINDING.batch(statements.slice(index, index + 50));
    }
  } catch {
    console.error('DISCUSSION_WEBHOOK_ENQUEUE_FAILED');
    return new Response(null, { status: 503 });
  }
  if (statements.length > 0) {
    const delivery = sendDiscussionNotifications(env, fetch, token ?? undefined).catch(() => {
      console.error('DISCUSSION_WEBHOOK_DELIVERY_FAILED');
    });
    if (ctx) ctx.waitUntil(delivery);
    else await delivery;
  }
  return new Response(null, { status: 204 });
}

function notificationParticipants(members: unknown[]) {
  const coach = members.find(member => record(member) && Array.isArray(member.roles) && member.roles.includes('coach'));
  const client = members.find(member => record(member) && Array.isArray(member.roles) && member.roles.includes('client'));
  if (!record(coach) || typeof coach.userId !== 'string'
    || !record(client) || typeof client.userId !== 'string') return null;
  return { coach: { userId: coach.userId, name: coach.name }, clientUserId: client.userId };
}

async function recipientHasRead(
  realmId: string, threadId: string, recipientUserId: string, messageId: string,
  createdAt: unknown, token: string, fetchImpl: typeof fetch,
): Promise<boolean> {
  if (!discussionInstant(createdAt)) return false;
  const target = discussionCursorKey({ id: messageId, createdAt });
  const currentId = discussionReadStateId(realmId, threadId, recipientUserId);
  const state = await cloudRead(cloudPath('discussionReadStates', currentId), token, fetchImpl, true);
  const cursor = discussionReadCursor(state, realmId, threadId, recipientUserId);
  if (cursor && discussionCursorKey(cursor) >= target) return true;
  if (state !== null) return false;
  const legacyId = JSON.stringify([realmId, threadId, recipientUserId]);
  const legacy = await cloudRead(cloudPath('discussionReadStates', legacyId), token, fetchImpl, true);
  const legacyCursor = discussionReadCursor(legacy, realmId, threadId, recipientUserId);
  return legacyCursor !== null && discussionCursorKey(legacyCursor) >= target;
}

async function publicationAlreadyRead(messageId: string, realmId: string, token: string): Promise<boolean> {
  const message = await cloudRead(cloudPath('discussionMessages', messageId), token, fetch, true);
  if (!record(message) || message.id !== messageId || message.realmId !== realmId
    || !discussionId(message.threadId) || typeof message.authorUserId !== 'string'
    || message.owner !== message.authorUserId || message.draftForRealmId || message.deletedAt) return false;
  const members = await cloudList('/all/members?realmId=' + encodeURIComponent(realmId), token, fetch);
  const pair = notificationParticipants(members);
  if (!pair || (message.authorUserId !== pair.coach.userId && message.authorUserId !== pair.clientUserId)) return false;
  if (!await readNotificationRelationship({
    realmId, coachUserId: pair.coach.userId, clientUserId: pair.clientUserId,
  }, token, fetch, members)) return false;
  const recipient = message.authorUserId === pair.coach.userId ? pair.clientUserId : pair.coach.userId;
  return recipientHasRead(realmId, message.threadId, recipient, messageId, message.createdAt, token, fetch);
}

interface PendingDiscussion { message_id: string; realm_id: string; attempts: number }

async function deliver(env: DiscussionNotificationEnv, event: PendingDiscussion, token: string, fetchImpl: typeof fetch) {
  const message = await cloudRead(cloudPath('discussionMessages', event.message_id), token, fetchImpl, true);
  if (message === null) throw new Error('DISCUSSION_MESSAGE_PENDING');
  if (!record(message) || message.id !== event.message_id || message.realmId !== event.realm_id
    || message.draftForRealmId || message.deletedAt || !discussionId(message.threadId)
    || typeof message.authorUserId !== 'string' || !validatedTelegramId(message.authorUserId)
    || message.owner !== message.authorUserId || typeof message.text !== 'string') return null;
  const members = await cloudList('/all/members?realmId=' + encodeURIComponent(event.realm_id), token, fetchImpl);
  const pair = notificationParticipants(members);
  if (!pair) return null;
  const { coach, clientUserId } = pair;
  const relationship = await readNotificationRelationship({
    realmId: event.realm_id, coachUserId: coach.userId, clientUserId,
  }, token, fetchImpl, members);
  if (!relationship || (message.authorUserId !== clientUserId && message.authorUserId !== coach.userId)) return null;
  const toCoach = message.authorUserId === clientUserId;
  const recipientUserId = toCoach ? coach.userId : clientUserId;
  if (toCoach && (!await enabledByPreference(recipientUserId, 'telegram', token, fetchImpl)
    || !await enabledByPreference(recipientUserId, 'discussion', token, fetchImpl))) return null;
  const thread = await cloudRead(cloudPath('discussionThreads', message.threadId), token, fetchImpl, true);
  if (thread === null) throw new Error('DISCUSSION_THREAD_PENDING');
  if (!record(thread) || thread.id !== message.threadId || thread.realmId !== event.realm_id
    || thread.coachClientId !== event.realm_id || thread.owner !== event.realm_id || !isDiscussionAnchor(thread.anchor)
    || thread.anchorKey !== discussionAnchorKey({ realmId: event.realm_id, coachClientId: event.realm_id }, thread.anchor)) return null;
  const attachments = await cloudList('/all/messageAttachments?messageId=' + encodeURIComponent(event.message_id), token, fetchImpl);
  const attachment = attachments.find(item => record(item) && item.realmId === event.realm_id
    && item.messageId === event.message_id && item.owner === message.authorUserId
    && item.authorUserId === message.authorUserId && !item.deletedAt && item.uploadState === 'ready');
  if (!message.text.trim() && !attachment) throw new Error('DISCUSSION_ATTACHMENT_PENDING');
  const kind = record(attachment) ? attachment.mediaType : undefined;
  const title = kind === 'video' ? 'Новое видео в обсуждении'
    : kind === 'photo' ? 'Новое фото в обсуждении'
    : kind === 'voice' ? 'Голосовое сообщение в обсуждении'
    : kind === 'video-note' ? 'Видеосообщение в обсуждении' : 'Новое сообщение в обсуждении';
  const membershipName = toCoach ? relationship.clientName
    : typeof coach.name === 'string' && coach.name.trim() ? coach.name : 'Тренер';
  const peerName = await readNotificationClientName(
    event.realm_id, message.authorUserId, membershipName, token, fetchImpl,
  );
  if (await recipientHasRead(event.realm_id, message.threadId, recipientUserId,
    event.message_id, message.createdAt, token, fetchImpl)) return null;
  return sendTopicTelegram(env, {
    recipientUserId,
    peer: { userId: message.authorUserId, name: peerName },
    title,
    context: typeof thread.derivedTitleSnapshot === 'string' ? thread.derivedTitleSnapshot.slice(0, 200) : undefined,
    button: 'Открыть обсуждение',
    target: { kind: 'discussion', id: event.message_id },
  }, fetchImpl);
}

export async function sendDiscussionNotifications(
  env: DiscussionNotificationEnv, fetchImpl: typeof fetch = fetch, existingToken?: string,
) {
  if (!env.DEXIE_DISCUSSION_WEBHOOK_SECRET) return;
  const now = Date.now();
  const { results } = await env.DB_BINDING.prepare(`
    SELECT message_id, realm_id, attempts FROM telegram_discussion_delivery
    WHERE status = 'pending' AND attempts < 12 AND next_attempt_at <= ?
    ORDER BY next_attempt_at LIMIT 20
  `).bind(now).all<PendingDiscussion>();
  if (!results.length) return;
  const token = existingToken ?? await cloudToken(env, fetchImpl);
  for (const event of results) {
    const claim = await env.DB_BINDING.prepare(`
      UPDATE telegram_discussion_delivery SET next_attempt_at = ?, attempts = attempts + 1
      WHERE message_id = ? AND realm_id = ? AND status = 'pending' AND attempts = ? AND next_attempt_at <= ?
    `).bind(now + 300_000, event.message_id, event.realm_id, event.attempts, now).run();
    if (claim.meta.changes !== 1) continue;
    const result = await deliver(env, event, token, fetchImpl).catch(() => ({
      status: 'retry' as const, waitSeconds: 300,
    }));
    const status = result?.status === 'retry' && event.attempts < 11 ? 'pending'
      : result?.status === 'sent' ? 'sent' : 'closed';
    await env.DB_BINDING.prepare(`
      UPDATE telegram_discussion_delivery SET status = ?, next_attempt_at = ?
      WHERE message_id = ? AND realm_id = ? AND attempts = ?
    `).bind(status, Date.now() + (result?.waitSeconds ?? 0) * 1000, event.message_id, event.realm_id, event.attempts + 1).run();
  }
}
