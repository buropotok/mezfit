import { userView, type Role, type UserRow } from './account-profile';

const REPLICA_URL = 'https://mezfit.online/api/internal/account-replication';
const REQUEST_TIMEOUT_MS = 5_000;
const TICK_LIMIT = 20;
const RETRY_MINUTES = [5, 10, 20, 40, 60] as const;

interface PendingAccount extends UserRow {
  revision: number;
  attempts: number;
  next_attempt_at: number;
  has_client: number;
  has_coach: number;
}

function confirmedRevision(body: unknown, sent: number): boolean {
  if (!body || typeof body !== 'object' || !('revision' in body) || !('status' in body)) return false;
  const { revision, status } = body;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision)) return false;
  if (status === 'stale') return revision > sent;
  return (status === 'applied' || status === 'duplicate') && revision === sent;
}

async function postSnapshot(secret: string, row: PendingAccount): Promise<string | null> {
  const roles: Role[] = [];
  if (row.has_client === 1) roles.push('client');
  if (row.has_coach === 1) roles.push('coach');

  let response: Response;
  try {
    response = await fetch(REPLICA_URL, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ revision: row.revision, user: userView(row), roles }),
    });
  } catch {
    return 'REQUEST_FAILED';
  }

  if (response.status !== 200) {
    await response.body?.cancel().catch(() => {});
    switch (response.status) {
      case 400: return 'INVALID_SNAPSHOT';
      case 401: return 'UNAUTHORIZED';
      case 409: return 'REVISION_CONFLICT';
      case 503: return 'REPLICA_UNAVAILABLE';
      default: return 'UNEXPECTED_HTTP_STATUS';
    }
  }

  const body: unknown = await response.json().catch(() => null);
  return confirmedRevision(body, row.revision) ? null : 'INVALID_ACKNOWLEDGEMENT';
}

export async function deliverAccountReplicas(env: Env, telegramUserId?: string): Promise<void> {
  const secret = env.MEZFIT_ACCOUNT_REPLICATION_SECRET;
  if (!secret) return;
  const db = env.DB_BINDING;

  // Read profile, roles and revision together so the payload corresponds to its revision.
  const byAccount = telegramUserId !== undefined;
  const result = await db.prepare(`
    SELECT u.id, u.telegram_user_id, u.username, u.first_name, u.last_name,
      u.language_code, u.photo_url, u.is_premium, o.revision, o.attempts, o.next_attempt_at,
      EXISTS (SELECT 1 FROM user_role WHERE user_id = u.id AND role = 'client') AS has_client,
      EXISTS (SELECT 1 FROM user_role WHERE user_id = u.id AND role = 'coach') AS has_coach
    FROM account_replication_outbox AS o
    JOIN app_user AS u ON u.telegram_user_id = o.telegram_user_id
    WHERE o.next_attempt_at <= ? ${byAccount ? 'AND o.telegram_user_id = ?' : ''}
    ORDER BY o.next_attempt_at, o.telegram_user_id
    LIMIT ?
  `).bind(...(byAccount ? [Date.now(), telegramUserId, 1] : [Date.now(), TICK_LIMIT])).all<PendingAccount>();

  for (const row of result.results) {
    const failure = await postSnapshot(secret, row);
    if (failure === null) {
      await db.prepare(`
        UPDATE account_replication_outbox
        SET next_attempt_at = NULL, last_error = NULL
        WHERE telegram_user_id = ? AND revision = ?
      `).bind(row.telegram_user_id, row.revision).run();
      continue;
    }

    const delay = RETRY_MINUTES[Math.min(row.attempts, RETRY_MINUTES.length - 1)];
    const nextAttempt = Date.now() + delay * 60_000;
    const retry = await db.prepare(`
      UPDATE account_replication_outbox
      SET attempts = attempts + 1, next_attempt_at = ?, last_error = ?
      WHERE telegram_user_id = ? AND revision = ? AND attempts = ? AND next_attempt_at = ?
    `).bind(nextAttempt, failure, row.telegram_user_id, row.revision, row.attempts, row.next_attempt_at).run();
    if (retry.meta.changes > 0) console.warn('ACCOUNT_REPLICATION_RETRY', failure);
  }
}

export function queueImmediateAccountDelivery(env: Env, ctx: ExecutionContext | undefined, telegramUserId: string): void {
  if (!ctx || !env.MEZFIT_ACCOUNT_REPLICATION_SECRET) return;
  ctx.waitUntil(deliverAccountReplicas(env, telegramUserId).catch(() => {
    console.error('ACCOUNT_REPLICATION_IMMEDIATE_FAILED');
  }));
}
