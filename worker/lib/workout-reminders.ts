import cloudConfig from '../../dexie-cloud.json';
import { checkApprovedAssignedPair, validatedTelegramId, type RelationshipMemberView } from '../../shared/approved-relationship';
import { flexAttributeId, flexValueId } from '../../shared/flex-identifiers';

import { COACH_TELEGRAM_PREFERENCES } from '../../shared/telegram-notification-link';
import { sendCoachTelegram } from './coach-telegram';

import { stableCloudRelationshipId } from '../../shared/relationship-id';

type Preference = 'client' | 'coached' | 'own';

export interface WorkoutReminderEnv {
  DB_BINDING: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_BOT_USERNAME: string;
  DEXIE_DISCUSSION_WEBHOOK_SECRET?: string;
  DEXIE_CLOUD_REMINDER_CLIENT_ID?: string;
  DEXIE_CLOUD_REMINDER_CLIENT_SECRET?: string;
}

interface Occurrence {
  id: string;
  realmId: string;
  athleteUserId: string;
  coachUserId: string | null;
  clientUserId: string | null;
  startsAtUtc: string;
  format: 'independent' | 'coached';
}

interface Recipient {
  userId: string;
  preference: Preference;
}

const REMINDER_LEAD_MS = 60 * 60 * 1000;
const REMINDER_GRACE_MS = 10 * 60 * 1000;
const MAX_DELIVERY_ATTEMPTS = 3;

const KEYS: Record<Preference, string> = {
  client: 'notify_client_workouts',
  coached: 'notify_coach_client_workouts',
  own: 'notify_coach_own_workouts',
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validOccurrence(value: unknown): value is Occurrence {
  if (!record(value)) return false;
  return typeof value.id === 'string' && value.id.length > 0
    && typeof value.realmId === 'string' && value.realmId.length > 0
    && (value.owner === null || value.owner === value.realmId)
    && typeof value.athleteUserId === 'string' && validatedTelegramId(value.athleteUserId) !== null
    && (value.coachUserId === null || (typeof value.coachUserId === 'string' && validatedTelegramId(value.coachUserId) !== null))
    && (value.clientUserId === null || (typeof value.clientUserId === 'string' && validatedTelegramId(value.clientUserId) !== null))
    && typeof value.startsAtUtc === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.startsAtUtc)
    && Number.isFinite(Date.parse(value.startsAtUtc))
    && value.status === 'scheduled' && value.workoutSessionId === null
    && value.publicationStatus === 'published'
    && (value.entryKind === undefined || value.entryKind === 'workout')
    && (value.inactive === undefined || value.inactive === false)
    && (value.cancelledAt === undefined || value.cancelledAt === null)
    && (value.format === 'independent' || value.format === 'coached');
}

function isPersonal(row: Occurrence): boolean {
  return row.realmId === row.athleteUserId && row.coachUserId === null
    && row.clientUserId === null && row.format === 'independent';
}

function isAssigned(row: Occurrence): row is Occurrence & { coachUserId: string; clientUserId: string } {
  return row.coachUserId !== null && row.clientUserId === row.athleteUserId
    && row.clientUserId !== row.coachUserId;
}

/** Physical participation, never the current UI role or the booking creator. */
export function reminderRecipients(
  row: Pick<Occurrence, 'athleteUserId' | 'coachUserId' | 'clientUserId' | 'format' | 'realmId'>,
  personalRole?: 'coach' | 'client',
): Recipient[] {
  if (row.coachUserId === null && row.clientUserId === null && row.realmId === row.athleteUserId
    && row.format === 'independent') {
    return personalRole ? [{ userId: row.athleteUserId, preference: personalRole === 'coach' ? 'own' : 'client' }] : [];
  }
  if (!row.coachUserId || row.clientUserId !== row.athleteUserId
    || row.coachUserId === row.athleteUserId) return [];
  return [
    { userId: row.athleteUserId, preference: 'client' },
    ...(row.format === 'coached' ? [{ userId: row.coachUserId, preference: 'coached' as const }] : []),
  ];
}

export async function cloudToken(env: WorkoutReminderEnv, fetchImpl: typeof fetch): Promise<string> {
  if (!env.DEXIE_CLOUD_REMINDER_CLIENT_ID || !env.DEXIE_CLOUD_REMINDER_CLIENT_SECRET) {
    throw new Error('REMINDERS_CLOUD_READ_NOT_CONFIGURED');
  }
  const response = await fetchImpl(cloudConfig.dbUrl + '/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      scopes: ['ACCESS_DB', 'GLOBAL_READ'],
      client_id: env.DEXIE_CLOUD_REMINDER_CLIENT_ID,
      client_secret: env.DEXIE_CLOUD_REMINDER_CLIENT_SECRET,
    }),
  });
  if (!response.ok) throw new Error('REMINDERS_CLOUD_TOKEN_FAILED');
  const json: unknown = await response.json();
  if (!record(json) || json.type !== 'tokens' || typeof json.accessToken !== 'string'
    || !json.accessToken) throw new Error('REMINDERS_CLOUD_TOKEN_INVALID');
  return json.accessToken;
}

export async function cloudRead(
  path: string, token: string, fetchImpl: typeof fetch, missing = false,
): Promise<unknown> {
  const response = await fetchImpl(cloudConfig.dbUrl + path, {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
  });
  if (missing && response.status === 404) return null;
  if (!response.ok) throw new Error('REMINDERS_CLOUD_READ_FAILED');
  const value: unknown = await response.json();
  return value;
}

export async function cloudList(path: string, token: string, fetchImpl: typeof fetch): Promise<unknown[]> {
  const response = await cloudRead(path, token, fetchImpl);
  if (!Array.isArray(response)) throw new Error('REMINDERS_CLOUD_LIST_INVALID');
  return response;
}

function restoredMember(value: unknown): RelationshipMemberView | null {
  if (!record(value) || typeof value.id !== 'string' || typeof value.realmId !== 'string'
    || typeof value.userId !== 'string' || !Array.isArray(value.roles)
    || !value.roles.every(role => typeof role === 'string')) return null;
  const accepted = value.accepted === true ? true
    : record(value.accepted) && value.accepted.$t === 'Date' && typeof value.accepted.v === 'string'
      ? new Date(value.accepted.v) : undefined;
  return {
    id: value.id, realmId: value.realmId, userId: value.userId, owner: value.owner,
    roles: value.roles as string[],
    accepted, invite: value.invite === true, permissions: value.permissions,
  };
}

export async function readNotificationRelationship(
  row: { realmId: string; coachUserId: string; clientUserId: string },
  token: string,
  fetchImpl: typeof fetch,
  existingMembers?: unknown[],
): Promise<{ clientName: string } | null> {
  const [realm, rawMembers] = await Promise.all([
    cloudRead('/all/realms/' + encodeURIComponent(row.realmId), token, fetchImpl, true),
    existingMembers ?? cloudList('/all/members?realmId=' + encodeURIComponent(row.realmId), token, fetchImpl),
  ]);
  if (!record(realm)) return null;
  const members = rawMembers.map(restoredMember);
  if (members.some(member => member === null)) return null;
  const approved = await checkApprovedAssignedPair({
    realm: { realmId: typeof realm.realmId === 'string' ? realm.realmId : '',
      owner: realm.owner, name: typeof realm.name === 'string' ? realm.name : undefined },
    members: members.filter((member): member is RelationshipMemberView => member !== null),
    coachUserId: row.coachUserId,
    clientUserId: row.clientUserId,
  });
  if (!approved) return null;
  const client = rawMembers.find(member => record(member) && member.userId === row.clientUserId);
  return { clientName: record(client) && typeof client.name === 'string' ? client.name : 'Клиент' };
}

/** Read the same realm-scoped contact name used by the Mezfit client list.
 * Call only after validating the coach/client relationship.
 */
export async function readNotificationClientName(
  realmId: string, clientUserId: string, membershipName: string, token: string, fetchImpl: typeof fetch,
): Promise<string> {
  const id = await stableCloudRelationshipId('prf', realmId + ':' + clientUserId);
  const profile = await cloudRead('/all/contactProfiles/' + encodeURIComponent(id), token, fetchImpl, true);
  if (record(profile) && profile.id === id && profile.realmId === realmId
    && profile.userId === clientUserId && profile.owner === null && typeof profile.name === 'string') {
    return profile.name.trim() || membershipName;
  }
  return membershipName;
}

async function personalRole(userId: string, db: D1Database): Promise<'coach' | 'client' | undefined> {
  const user = validatedTelegramId(userId);
  if (!user) return undefined;
  const roles = await db.prepare(
    'SELECT role FROM user_role JOIN app_user ON app_user.id = user_role.user_id WHERE app_user.telegram_user_id = ?',
  ).bind(user).all<{ role: string }>();
  if (roles.results.length !== 1) return undefined; // Dual-role users are out of MVP scope.
  return roles.results[0].role === 'coach' || roles.results[0].role === 'client'
    ? roles.results[0].role : undefined;
}

export async function enabledByPreference(
  userId: string, preference: Preference | 'telegram' | 'discussion', token: string, fetchImpl: typeof fetch,
): Promise<boolean> {
  const key = preference === 'telegram' || preference === 'discussion'
    ? COACH_TELEGRAM_PREFERENCES[preference] : KEYS[preference];
  const target = { entityType: 'user' as const, entityId: userId, realmId: userId };
  const id = flexValueId(target, flexAttributeId(userId, key));
  const value = await cloudRead('/all/flexValues/' + encodeURIComponent(id), token, fetchImpl, true);
  if (value === null) return true; // Product default.
  if (!record(value) || value.id !== id || value.realmId !== userId || value.owner !== userId
    || value.entityType !== 'user' || value.entityId !== userId
    || value.attributeId !== flexAttributeId(userId, key)
    || (value.value !== null && typeof value.value !== 'boolean')) return false;
  // A cleared Flex Value is stored as null, matching the client's enabled-by-default rule.
  return value.value === null ? true : value.value;
}

async function deliveryKey(occurrence: Occurrence, recipient: Recipient): Promise<string> {
  const text = [occurrence.id, occurrence.startsAtUtc, recipient.userId, recipient.preference].join('\u0000');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function claimDelivery(
  db: D1Database, key: string, occurrence: Occurrence, recipient: Recipient, now: string,
): Promise<boolean> {
  await db.prepare(`
    INSERT OR IGNORE INTO workout_reminder_delivery
      (id, occurrence_id, recipient_user_id, starts_at_utc, kind, status, next_attempt_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `).bind(key, occurrence.id, recipient.userId, occurrence.startsAtUtc, recipient.preference, now).run();
  const claimed = await db.prepare(`
    UPDATE workout_reminder_delivery
       SET status = 'sending', attempts = attempts + 1, attempted_at = ?
     WHERE id = ? AND attempts < ?
       AND (status = 'pending' OR (status = 'retry' AND next_attempt_at <= ?))
  `).bind(now, key, MAX_DELIVERY_ATTEMPTS, now).run();
  return claimed.meta.changes === 1;
}

async function sendTelegram(
  env: WorkoutReminderEnv, recipient: Recipient, fetchImpl: typeof fetch,
): Promise<{ status: 'sent' | 'blocked' | 'retry'; messageId: number | null; waitSeconds: number }> {
  const telegramUserId = validatedTelegramId(recipient.userId);
  if (!telegramUserId || !/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(env.TELEGRAM_BOT_USERNAME)) {
    return { status: 'blocked', messageId: null, waitSeconds: 0 };
  }
  const text = recipient.preference === 'coached'
    ? '🏋️ Через час совместная тренировка с клиентом. Откройте Mezfit, чтобы подготовиться.'
    : '🏋️ Через час ваша тренировка. Откройте Mezfit, чтобы посмотреть план.';
  let response: Response;
  try {
    response = await fetchImpl('https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramUserId,
        text,
        reply_markup: { inline_keyboard: [[{
          text: 'Открыть Mezfit',
          url: 'https://t.me/' + env.TELEGRAM_BOT_USERNAME + '?startapp=reminder',
        }]] },
      }),
    });
  } catch {
    return { status: 'retry', messageId: null, waitSeconds: 300 };
  }
  let body: unknown = null;
  try { body = await response.json(); } catch { /* An invalid upstream payload is retryable. */ }
  if (response.ok && record(body) && body.ok === true && record(body.result)
    && typeof body.result.message_id === 'number' && Number.isSafeInteger(body.result.message_id)) {
    return { status: 'sent', messageId: body.result.message_id, waitSeconds: 0 };
  }
  if (response.status === 400 || response.status === 403) {
    return { status: 'blocked', messageId: null, waitSeconds: 0 };
  }
  const retryAfter = record(body) && record(body.parameters)
    && typeof body.parameters.retry_after === 'number'
    ? body.parameters.retry_after : 0;
  return { status: 'retry', messageId: null,
    waitSeconds: Math.max(300, Number.isFinite(retryAfter) ? Math.min(retryAfter, 3600) : 0) };
}

async function deliver(
  env: WorkoutReminderEnv, occurrence: Occurrence, recipient: Recipient, at: number, fetchImpl: typeof fetch,
  clientName?: string,
): Promise<void> {
  const now = new Date(at).toISOString();
  const key = await deliveryKey(occurrence, recipient);
  if (!await claimDelivery(env.DB_BINDING, key, occurrence, recipient, now)) return;
  const result = recipient.preference === 'client' || !env.DEXIE_DISCUSSION_WEBHOOK_SECRET ? await sendTelegram(env, recipient, fetchImpl)
    : await sendCoachTelegram(env, {
      coachUserId: recipient.userId,
      client: occurrence.clientUserId ? { userId: occurrence.clientUserId, name: clientName ?? 'Клиент' } : undefined,
      title: recipient.preference === 'coached' ? 'Совместная тренировка через час' : 'Ваша тренировка через час',
      button: 'Открыть тренировку',
      target: { kind: 'workout', id: occurrence.id },
    }, fetchImpl);
  await env.DB_BINDING.prepare(`
    UPDATE workout_reminder_delivery
       SET status = ?, telegram_message_id = ?, sent_at = ?,
           next_attempt_at = ?, last_error_code = ?
     WHERE id = ? AND status = 'sending'
  `).bind(
    result.status, result.messageId, result.status === 'sent' ? now : null,
    new Date(at + result.waitSeconds * 1000).toISOString(),
    result.status === 'sent' ? null : result.status === 'blocked' ? 'telegram_blocked' : 'telegram_retry',
    key,
  ).run();
}

/**
 * Every Cron tick reads authoritative synchronized cloud state. No calendar data is
 * copied into D1. D1 stores only per-recipient technical delivery/idempotency metadata.
 */
export async function sendWorkoutReminders(
  env: WorkoutReminderEnv, at: number, fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!Number.isFinite(at)) throw new Error('REMINDERS_INVALID_TIME');
  const token = await cloudToken(env, fetchImpl);
  const rows = await cloudList('/all/workoutOccurrences?status=scheduled&publicationStatus=published', token, fetchImpl);
  if (rows.length > 25_000) throw new Error('REMINDERS_SCAN_LIMIT_EXCEEDED');
  let failedRecipients = 0;
  for (const raw of rows) {
    if (!validOccurrence(raw)) continue;
    const due = Date.parse(raw.startsAtUtc) - REMINDER_LEAD_MS;
    if (due > at || due <= at - REMINDER_GRACE_MS) continue;
    let recipients: Recipient[];
    let clientName: string | undefined;
    try {
      if (!isPersonal(raw)) {
        if (!isAssigned(raw)) continue;
        const relationship = await readNotificationRelationship(raw, token, fetchImpl);
        if (!relationship) continue;
        clientName = relationship.clientName;
      }
      const role = isPersonal(raw) ? await personalRole(raw.athleteUserId, env.DB_BINDING) : undefined;
      recipients = reminderRecipients(raw, role);
    } catch {
      failedRecipients += 1;
      continue;
    }
    for (const recipient of recipients) {
      try {
        if (!await enabledByPreference(recipient.userId, recipient.preference, token, fetchImpl)) continue;
        // The master switch belongs to the topic-based delivery rollout.
        if (recipient.preference !== 'client' && env.DEXIE_DISCUSSION_WEBHOOK_SECRET
          && !await enabledByPreference(recipient.userId, 'telegram', token, fetchImpl)) continue;
        // A cancellation or reschedule synchronized during this tick must suppress the old reminder.
        const current = await cloudRead('/all/workoutOccurrences/' + encodeURIComponent(raw.id), token, fetchImpl, true);
        if (!validOccurrence(current) || current.id !== raw.id
          || current.startsAtUtc !== raw.startsAtUtc || current.realmId !== raw.realmId
          || current.format !== raw.format || current.athleteUserId !== raw.athleteUserId
          || current.coachUserId !== raw.coachUserId || current.clientUserId !== raw.clientUserId) continue;
        const topicName = recipient.preference === 'coached' && env.DEXIE_DISCUSSION_WEBHOOK_SECRET && isAssigned(raw)
          ? await readNotificationClientName(raw.realmId, raw.clientUserId, clientName ?? 'Клиент', token, fetchImpl)
          : clientName;
        await deliver(env, raw, recipient, at, fetchImpl, topicName);
      } catch {
        // One user's transport or storage failure must not suppress other athletes.
        failedRecipients += 1;
      }
    }
  }
  if (failedRecipients > 0) {
    console.error('REMINDERS_PARTIAL_FAILURE', { count: failedRecipients });
    throw new Error('REMINDERS_PARTIAL_FAILURE');
  }
}
