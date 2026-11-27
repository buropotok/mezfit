import { userView, type Role, type UserRow } from './account-profile';

const REPLICA_URL = 'https://mezfit.online/api/internal/account-replication';
const REQUEST_TIMEOUT_MS = 5_000;
const TICK_LIMIT = 20;
const REQUEST_ID_HEADER = 'x-mezfit-replica-request-id';
const ERROR_DETAIL_HEADER = 'x-mezfit-replica-error-detail';
const RECEIVER_ERRORS: Readonly<Record<number, readonly string[]>> = {
  400: ['INVALID_SNAPSHOT'],
  401: ['UNAUTHORIZED'],
  405: ['METHOD_NOT_ALLOWED'],
  409: ['REVISION_CONFLICT', 'IDENTITY_CONFLICT'],
  503: ['REPLICA_UNAVAILABLE', 'REPLICATION_NOT_CONFIGURED'],
};
const SNAPSHOT_DETAIL = /^(?:DUPLICATE_FIELD|BODY_TYPE_OR_SIZE|BODY_TOO_LARGE|BODY_BASE64|BODY_ENCODING|BODY_JSON|SNAPSHOT_SHAPE|IDENTITY_SHAPE|USER_SHAPE|REVISION|TELEGRAM_ID|D1_ID|IS_PREMIUM|ROLES|username|firstName|lastName|languageCode|photoUrl)$/;
const DATABASE_DETAIL = /^(?:CONNECT|SESSION|PREPARE_READ|PREPARE_WRITE|READ|COMMIT_READ|WRITE_COMMIT|WRITE):(?:CONFIG_MISSING|AUTHENTICATION|PERMISSION|CONNECTION|TIMEOUT|UNAVAILABLE|OVERLOADED|SCHEMA|BAD_QUERY|PRECONDITION|ABORTED|SESSION_POOL_EMPTY|BAD_SESSION|COMMIT_UNKNOWN|INTERNAL|UNCLASSIFIED)$/;
const RETRY_MINUTES = [5, 10, 20, 40, 60] as const;

interface PendingDelivery {
  replication_key: string;
  revision: number;
  attempts: number;
  next_attempt_at: number;
  has_client: number;
  has_coach: number;
}

type PendingAccount = PendingDelivery & (UserRow | { id: null; telegram_user_id: null }) & {
  full_snapshot?: 0 | 1;
  account_exists?: 0 | 1;
  login?: string | null;
  pass_hash?: string | null;
};

function confirmedRevision(body: unknown, sent: number, full: boolean): boolean {
  if (!body || typeof body !== 'object' || !('revision' in body) || !('status' in body)) return false;
  const { revision, status } = body;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision)) return false;
  if (status === 'stale') return !full && revision > sent;
  return (status === 'applied' || status === 'duplicate') && revision === sent;
}

interface DeliveryFailure {
  code: string;
  httpStatus: number | null;
}

async function receiverFailure(response: Response, requestId: string): Promise<DeliveryFailure> {
  const httpStatus = response.status;
  if (httpStatus >= 300 && httpStatus < 400) {
    await response.body?.cancel().catch(() => {});
    return { code: 'REDIRECT_REFUSED', httpStatus };
  }

  const known = RECEIVER_ERRORS[httpStatus];
  if (!known) {
    await response.body?.cancel().catch(() => {});
    return { code: `HTTP_${httpStatus}`, httpStatus };
  }
  const body: unknown = await response.json().catch(() => null);
  const error = body && typeof body === 'object' && 'error' in body ? body.error : null;
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  if (typeof code !== 'string' || !known.includes(code)) {
    return { code: `HTTP_${httpStatus}_UNRECOGNIZED_RESPONSE`, httpStatus };
  }
  const detail = response.headers.get(ERROR_DETAIL_HEADER);
  if (detail && response.headers.get(REQUEST_ID_HEADER) === requestId
      && ((code === 'INVALID_SNAPSHOT' && SNAPSHOT_DETAIL.test(detail))
        || (code === 'REPLICA_UNAVAILABLE' && DATABASE_DETAIL.test(detail)))) {
    return { code: `${code}:${detail}`, httpStatus };
  }
  return { code, httpStatus };
}

async function postSnapshot(secret: string, row: PendingAccount, requestId: string): Promise<DeliveryFailure | null> {
  const roles: Role[] = [];
  if (row.has_client === 1) roles.push('client');
  if (row.has_coach === 1) roles.push('coach');

  const full = row.full_snapshot === 1;
  const profile = { revision: row.revision, user: row.id === null ? null : userView(row), roles };
  const snapshot = full ? {
    ...profile,
    identity: {
      userId: row.replication_key, telegramId: row.telegram_user_id,
      login: row.login ?? null, passHash: row.login == null ? null : row.pass_hash ?? null,
      state: row.account_exists === 1 ? 'active' : 'deleted',
    },
  } : profile;

  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(REPLICA_URL, {
      method: 'POST',
      redirect: 'manual',
      signal,
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
        [REQUEST_ID_HEADER]: requestId,
      },
      body: JSON.stringify(snapshot),
    });
  } catch {
    return { code: signal.aborted ? 'REQUEST_TIMEOUT' : 'REQUEST_FAILED', httpStatus: null };
  }

  if (response.status !== 200) return receiverFailure(response, requestId);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { code: signal.aborted ? 'RESPONSE_TIMEOUT' : 'INVALID_RESPONSE_JSON', httpStatus: 200 };
  }
  return confirmedRevision(body, row.revision, full) ? null : { code: 'INVALID_ACKNOWLEDGEMENT', httpStatus: 200 };
}

export async function deliverAccountReplicas(env: Env, telegramUserId?: string): Promise<void> {
  const secret = env.MEZFIT_ACCOUNT_REPLICATION_SECRET;
  if (!secret) return;
  const db = env.DB_BINDING;

  // Read profile, roles and revision together so the payload corresponds to its revision.
  const byAccount = telegramUserId !== undefined;
  const schema = await db.prepare(`
    SELECT name FROM sqlite_schema WHERE type = 'view' AND name = 'account_replication_source'
  `).bind().all<{ name: string }>();
  const upgraded = schema.results.length !== 0;
  // Both projections use the same queue and read the complete revision in one query.
  const source = upgraded
    ? 'LEFT JOIN account_replication_source AS u ON u.replication_key = o.telegram_user_id'
    : 'JOIN app_user AS u ON u.telegram_user_id = o.telegram_user_id';
  const result = await db.prepare(`
    SELECT u.id, u.telegram_user_id, u.username, u.first_name, u.last_name,
      u.language_code, u.photo_url, u.is_premium, o.revision, o.attempts, o.next_attempt_at,
      o.telegram_user_id AS replication_key,
      ${upgraded ? 'o.full_snapshot, u.replication_key IS NOT NULL AS account_exists, u.login, u.pass_hash,' : ''}
      EXISTS (SELECT 1 FROM user_role WHERE user_id = u.id AND role = 'client') AS has_client,
      EXISTS (SELECT 1 FROM user_role WHERE user_id = u.id AND role = 'coach') AS has_coach
    FROM account_replication_outbox AS o
    ${source}
    WHERE o.next_attempt_at <= ?
      ${upgraded ? 'AND (u.id IS NOT NULL OR o.full_snapshot = 1)' : ''}
      ${byAccount ? 'AND u.telegram_user_id = ?' : ''}
    ORDER BY o.next_attempt_at, o.telegram_user_id
    LIMIT ?
  `).bind(...(byAccount ? [Date.now(), telegramUserId, 1] : [Date.now(), TICK_LIMIT])).all<PendingAccount>();

  for (const row of result.results) {
    const requestId = crypto.randomUUID();
    const failure = await postSnapshot(secret, row, requestId);
    if (failure === null) {
      await db.prepare(`
        UPDATE account_replication_outbox
        SET next_attempt_at = NULL, last_error = NULL, last_request_id = NULL, last_http_status = NULL
          ${upgraded ? ", full_ack_revision = revision" : ""}
        WHERE telegram_user_id = ? AND revision = ?
      `).bind(row.replication_key, row.revision).run();
      continue;
    }

    const delay = RETRY_MINUTES[Math.min(row.attempts, RETRY_MINUTES.length - 1)];
    const nextAttempt = Date.now() + delay * 60_000;
    const retry = await db.prepare(`
      UPDATE account_replication_outbox
      SET attempts = attempts + 1, next_attempt_at = ?, last_error = ?, last_request_id = ?, last_http_status = ?
      WHERE telegram_user_id = ? AND revision = ? AND attempts = ? AND next_attempt_at = ?
    `).bind(nextAttempt, failure.code, requestId, failure.httpStatus,
      row.replication_key, row.revision, row.attempts, row.next_attempt_at).run();
    if (retry.meta.changes > 0) console.warn('ACCOUNT_REPLICATION_RETRY', {
      code: failure.code, request_id: requestId, http_status: failure.httpStatus,
    });
  }
}

export function queueImmediateAccountDelivery(env: Env, ctx: ExecutionContext | undefined, telegramUserId: string): void {
  if (!ctx || !env.MEZFIT_ACCOUNT_REPLICATION_SECRET) return;
  ctx.waitUntil(deliverAccountReplicas(env, telegramUserId).catch(() => {
    console.error('ACCOUNT_REPLICATION_IMMEDIATE_FAILED');
  }));
}
