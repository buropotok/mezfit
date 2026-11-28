import type { UserRow } from './account-profile';

export const PASSWORD_USER_ID_MIN = 2 ** 52;
const MAX_ALLOCATION_ATTEMPTS = 8;

interface AccountIdentityRow {
  user_id: number;
  app_user_id: number | null;
  login: string | null;
  password_configured: 0 | 1;
}

const identityColumns = `
  credentials.user_id, credentials.app_user_id, credentials.login,
  credentials.pass_hash IS NOT NULL AS password_configured
`;

export interface AccountIdentity {
  userId: number;
  appUserId: number | null;
  login: string | null;
  passwordConfigured: boolean;
}

interface TelegramAccountIdentity extends AccountIdentity {
  telegramId: number;
}

function accountIdentity(row: AccountIdentityRow): AccountIdentity {
  return {
    userId: row.user_id,
    appUserId: row.app_user_id,
    login: row.login,
    passwordConfigured: row.password_configured === 1,
  };
}

function validateId(id: number, errorCode: string): void {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(errorCode);
}

function verifiedTelegramKey(telegramId: number): string {
  validateId(telegramId, 'INVALID_TELEGRAM_ID');
  if (telegramId >= PASSWORD_USER_ID_MIN) throw new Error('TELEGRAM_ID_OUTSIDE_SUPPORTED_RANGE');
  return String(telegramId);
}

/** The caller must already have verified Telegram identity on the server. */
export function passwordCredentials(db: D1Database) {
  async function getByUserId(userId: number): Promise<AccountIdentity | null> {
    validateId(userId, 'INVALID_USER_ID');
    const row = await db.prepare(`
      SELECT ${identityColumns}
      FROM password_credentials AS credentials WHERE credentials.user_id = ?
    `).bind(userId).first<AccountIdentityRow>();
    return row && accountIdentity(row);
  }

  async function getByAppUserId(appUserId: number): Promise<AccountIdentity | null> {
    validateId(appUserId, 'INVALID_APP_USER_ID');
    const row = await db.prepare(`
      SELECT ${identityColumns}
      FROM password_credentials AS credentials WHERE credentials.app_user_id = ?
    `).bind(appUserId).first<AccountIdentityRow>();
    return row && accountIdentity(row);
  }

  async function resolveByVerifiedTelegramId(telegramId: number): Promise<TelegramAccountIdentity | null> {
    const row = await db.prepare(`
      SELECT ${identityColumns}
      FROM app_user AS account
      JOIN password_credentials AS credentials ON credentials.app_user_id = account.id
      WHERE account.telegram_user_id = ?
    `).bind(verifiedTelegramKey(telegramId)).first<AccountIdentityRow>();
    if (row && row.user_id < PASSWORD_USER_ID_MIN && row.user_id !== telegramId) {
      throw new Error('TELEGRAM_ACCOUNT_MAPPING_CONFLICT');
    }
    return row && { ...accountIdentity(row), telegramId };
  }

  async function createIdentityForExistingTelegramAccount(
    appUser: Pick<UserRow, 'id'>,
    verifiedTelegramId: number,
    { onlyIfNeverReplicated = false } = {},
  ): Promise<TelegramAccountIdentity> {
    validateId(appUser.id, 'INVALID_APP_USER_ID');
    const telegramKey = verifiedTelegramKey(verifiedTelegramId);

    // Resolve the current account, optional login and both uniqueness checks in one write.
    await db.prepare(`
      INSERT INTO password_credentials (user_id, app_user_id, login)
      SELECT CAST(account.telegram_user_id AS INTEGER), account.id,
        CASE
          WHEN length(account.username) BETWEEN 1 AND 32
            AND instr(account.username, char(0)) = 0
            AND account.username NOT GLOB '*[^A-Za-z0-9_]*'
            AND NOT EXISTS (
              SELECT 1 FROM app_user AS other
              WHERE other.id <> account.id AND lower(other.username) = lower(account.username)
            )
            AND NOT EXISTS (
              SELECT 1 FROM password_credentials WHERE login = lower(account.username)
            )
          THEN lower(account.username)
        END
      FROM app_user AS account
      WHERE account.id = ? AND account.telegram_user_id = ?
        ${onlyIfNeverReplicated ? `
          AND NOT EXISTS (
            SELECT 1 FROM account_replication_outbox
            WHERE telegram_user_id = account.telegram_user_id AND full_snapshot = 1
          )
        ` : ''}
      ON CONFLICT (app_user_id) DO NOTHING
      ON CONFLICT (user_id) DO NOTHING
    `).bind(appUser.id, telegramKey).run();

    const identity = await resolveByVerifiedTelegramId(verifiedTelegramId);
    if (identity?.appUserId !== appUser.id) throw new Error('TELEGRAM_ACCOUNT_MAPPING_CONFLICT');
    return identity;
  }

  return { getByUserId, getByAppUserId, resolveByVerifiedTelegramId, createIdentityForExistingTelegramAccount };
}

/**
 * The future caller must atomically insert the candidate using the primary key.
 * Return false only for a user_id collision, and propagate all other failures.
 */
export async function allocatePasswordUserId(insert: (userId: number) => Promise<boolean>): Promise<number> {
  const random = new Uint32Array(2);
  for (let attempt = 0; attempt < MAX_ALLOCATION_ATTEMPTS; attempt++) {
    crypto.getRandomValues(random);
    // Use exactly 52 random bits to cover the entire reserved interval uniformly.
    const candidate = PASSWORD_USER_ID_MIN + (random[0] & 0xfffff) * 2 ** 32 + random[1];
    if (await insert(candidate)) return candidate;
  }
  throw new Error('PASSWORD_USER_ID_ALLOCATION_EXHAUSTED');
}
