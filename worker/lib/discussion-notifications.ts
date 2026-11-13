import { discussionAnchorKey, discussionId, discussionRecord as record, isDiscussionAnchor } from '../../shared/discussion-anchor';
import { validatedTelegramId } from '../../shared/approved-relationship';
import { sendCoachTelegram } from './coach-telegram';
import { cloudList, cloudRead, cloudToken, enabledByPreference, readNotificationRelationship, type WorkoutReminderEnv } from './workout-reminders';

type DiscussionNotificationEnv = WorkoutReminderEnv;

const webhookPath = '/api/webhooks/dexie-discussions';
const realmKey = (value: unknown): value is string => typeof value === 'string' && /^rlm[a-f0-9]{28}$/.test(value);
const cloudPath = (table: string, id: string) => '/all/' + table + '/' + encodeURIComponent(id);

export async function receiveDiscussionNotifications(request: Request, env: DiscussionNotificationEnv): Promise<Response | null> {
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
  const statements: D1PreparedStatement[] = [];
  for (const change of data.changes) {
    if (!record(change) || change.table !== 'discussionMessages' || !discussionId(change.key)) continue;
    const realmId = change.type === 'upsert' && record(change.value) ? change.value.realmId
      : change.type === 'update' && record(change.updates) && Object.hasOwn(change.updates, 'realmId')
        ? change.updates.realmId : undefined;
    if (!realmKey(realmId)) continue;
    statements.push(env.DB_BINDING.prepare(
      'INSERT OR IGNORE INTO telegram_discussion_delivery (message_id, realm_id) VALUES (?, ?)',
    ).bind(change.key, realmId));
  }
  try {
    for (let index = 0; index < statements.length; index += 50) {
      await env.DB_BINDING.batch(statements.slice(index, index + 50));
    }
  } catch {
    console.error('DISCUSSION_WEBHOOK_ENQUEUE_FAILED');
    return new Response(null, { status: 503 });
  }
  return new Response(null, { status: 204 });
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
  const coach = members.find(member => record(member) && Array.isArray(member.roles) && member.roles.includes('coach'));
  if (!record(coach) || typeof coach.userId !== 'string') return null;
  const relationship = await readNotificationRelationship({
    realmId: event.realm_id, coachUserId: coach.userId, clientUserId: message.authorUserId,
  }, token, fetchImpl, members);
  if (!relationship || !await enabledByPreference(coach.userId, 'telegram', token, fetchImpl)
    || !await enabledByPreference(coach.userId, 'discussion', token, fetchImpl)) return null;
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
  return sendCoachTelegram(env, {
    coachUserId: coach.userId,
    client: { userId: message.authorUserId, name: relationship.clientName },
    title,
    context: typeof thread.derivedTitleSnapshot === 'string' ? thread.derivedTitleSnapshot.slice(0, 200) : undefined,
    button: 'Открыть обсуждение',
    target: { kind: 'discussion', id: event.message_id },
  }, fetchImpl);
}

export async function sendDiscussionNotifications(env: DiscussionNotificationEnv, fetchImpl: typeof fetch = fetch) {
  if (!env.DEXIE_DISCUSSION_WEBHOOK_SECRET) return;
  const now = Date.now();
  const { results } = await env.DB_BINDING.prepare(`
    SELECT message_id, realm_id, attempts FROM telegram_discussion_delivery
    WHERE status = 'pending' AND attempts < 12 AND next_attempt_at <= ?
    ORDER BY next_attempt_at LIMIT 20
  `).bind(now).all<PendingDiscussion>();
  if (!results.length) return;
  const token = await cloudToken(env, fetchImpl);
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
