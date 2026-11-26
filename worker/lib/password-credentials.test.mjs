import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allocatePasswordUserId, PASSWORD_USER_ID_MIN, passwordCredentials } from './password-credentials';

const loadMigration = (file) => readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8');

let db;
let credentials;

function addTelegramAccount(telegramId, username = null) {
  return db.prepare(`
    INSERT INTO app_user (telegram_user_id, first_name, username) VALUES (?, 'Example', ?)
    RETURNING id
  `).get(String(telegramId), username);
}

function addPasswordIdentity(userId, login) {
  // The encoded value is an opaque fixture, never a password or a real credential.
  db.prepare('INSERT INTO password_credentials (user_id, login, pass_hash) VALUES (?, ?, ?)')
    .run(BigInt(userId), login, 'encoded-hash-fixture');
}

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(loadMigration('0001_users_and_roles.sql'));
  db.exec(loadMigration('0036_password_credentials.sql'));
  credentials = passwordCredentials({
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        bind: (...args) => ({
          first: async () => statement.get(...args) ?? null,
          run: async () => statement.run(...args),
        }),
      };
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  db.close();
});

describe('password credentials identity', () => {
  it('maps simultaneous requests for the same verified account to the same identity', async () => {
    const account = addTelegramAccount(101, 'Some_Name');
    const create = () => credentials.createIdentityForExistingTelegramAccount(account, 101);
    const matches = await Promise.all([create(), create()]);
    const identity = { userId: 101, appUserId: account.id, login: 'some_name', passwordConfigured: false };

    expect(matches).toEqual([{ ...identity, telegramId: 101 }, { ...identity, telegramId: 101 }]);
    expect(await credentials.getByUserId(101)).toEqual(identity);
    expect(await credentials.getByAppUserId(account.id)).toEqual(identity);
    expect(db.prepare('SELECT pass_hash FROM password_credentials').get().pass_hash).toBeNull();
  });

  it('leaves missing, invalid, duplicate and already reserved usernames unset', async () => {
    addPasswordIdentity(PASSWORD_USER_ID_MIN, 'reserved');
    const accounts = [null, 'bad name', 'Same', 'sAME', 'Reserved'].map(
      (username, index) => addTelegramAccount(201 + index, username),
    );
    const identities = await Promise.all(accounts.map(
      (account, index) => credentials.createIdentityForExistingTelegramAccount(account, 201 + index),
    ));
    expect(identities.map(({ login }) => login)).toEqual([null, null, null, null, null]);
    expect(await credentials.getByUserId(PASSWORD_USER_ID_MIN)).toMatchObject({ login: 'reserved' });
  });

  it('resolves a later Telegram link without changing the password account or exposing the hash', async () => {
    const userId = Number.MAX_SAFE_INTEGER;
    addPasswordIdentity(userId, 'original');
    expect(await credentials.getByUserId(userId)).toEqual({
      userId, appUserId: null, login: 'original', passwordConfigured: true,
    });

    const account = addTelegramAccount(301, 'Different');
    expect(await credentials.resolveByVerifiedTelegramId(301)).toBeNull();
    db.prepare('UPDATE password_credentials SET app_user_id = ? WHERE user_id = ? AND app_user_id IS NULL')
      .run(account.id, BigInt(userId));

    const linkedIdentity = { userId, appUserId: account.id, login: 'original', passwordConfigured: true, telegramId: 301 };
    expect(await credentials.resolveByVerifiedTelegramId(301)).toEqual(linkedIdentity);
    expect(await credentials.createIdentityForExistingTelegramAccount(account, 301)).toEqual(linkedIdentity);
    expect(await credentials.getByUserId(301)).toBeNull();
    expect(db.prepare('SELECT pass_hash FROM password_credentials').get().pass_hash).toBe('encoded-hash-fixture');
  });

  it('rejects a mismatched verified Telegram ID and fails closed on an occupied internal ID', async () => {
    const owner = addTelegramAccount(401);
    const other = addTelegramAccount(402);
    await expect(credentials.createIdentityForExistingTelegramAccount(other, 401))
      .rejects.toThrow('TELEGRAM_ACCOUNT_MAPPING_CONFLICT');

    // Simulate a conflicting preexisting mapping in storage.
    db.prepare('INSERT INTO password_credentials (user_id, app_user_id) VALUES (401, ?)').run(other.id);
    await expect(credentials.createIdentityForExistingTelegramAccount(owner, 401))
      .rejects.toThrow('TELEGRAM_ACCOUNT_MAPPING_CONFLICT');
    await expect(credentials.resolveByVerifiedTelegramId(402)).rejects.toThrow('TELEGRAM_ACCOUNT_MAPPING_CONFLICT');
    expect(await credentials.getByAppUserId(owner.id)).toBeNull();
    expect(await credentials.getByUserId(401)).toMatchObject({ appUserId: other.id });
  });

  it('enforces unique links, case-insensitive login, foreign keys and immutable IDs', async () => {
    const first = addTelegramAccount(501, 'One');
    const other = addTelegramAccount(502);
    await credentials.createIdentityForExistingTelegramAccount(first, 501);

    const statements = [
      `INSERT INTO password_credentials (user_id, app_user_id) VALUES (503, ${first.id})`,
      `INSERT INTO password_credentials (user_id, app_user_id, login) VALUES (502, ${other.id}, 'one')`,
      `INSERT INTO password_credentials (user_id, app_user_id, login) VALUES (502, ${other.id}, 'ONE')`,
      "INSERT INTO password_credentials (user_id, login) VALUES (4503599627370496, 'no_hash')",
      "INSERT INTO password_credentials (user_id, pass_hash) VALUES (4503599627370496, 'encoded-hash-fixture')",
      'INSERT INTO password_credentials (user_id, app_user_id) VALUES (503, 999)',
      'UPDATE password_credentials SET user_id = 502 WHERE user_id = 501',
      `UPDATE password_credentials SET app_user_id = ${other.id} WHERE user_id = 501`,
      `DELETE FROM app_user WHERE id = ${first.id}`,
    ];
    for (const sql of statements) expect(() => db.exec(sql)).toThrow();

    expect(await credentials.getByUserId(501)).toMatchObject({ appUserId: first.id, login: 'one' });
    expect(await credentials.getByAppUserId(other.id)).toBeNull();
  });

  it.each(['NULL', '0', '-1', '1.25', '9007199254740992', "'1'", "'4503599627370496.01'", "'nope'"])(
    'rejects invalid SQL user_id %s without coercion',
    (id) => {
      const account = addTelegramAccount(601);
      expect(() => db.exec(`
        INSERT INTO password_credentials (user_id, app_user_id) VALUES (${id}, ${account.id})
      `)).toThrow();
    },
  );

  it.each([0, -1, 1.25, Number.MAX_SAFE_INTEGER + 1, NaN, '601'])(
    'rejects invalid numeric lookup input %s',
    async (id) => {
      await expect(credentials.getByUserId(id)).rejects.toThrow('INVALID_USER_ID');
    },
  );

  it('rejects IDs from the reserved range as Telegram IDs and requires a link for a legacy ID', async () => {
    const account = addTelegramAccount(PASSWORD_USER_ID_MIN);
    await expect(credentials.createIdentityForExistingTelegramAccount(account, PASSWORD_USER_ID_MIN))
      .rejects.toThrow('TELEGRAM_ID_OUTSIDE_SUPPORTED_RANGE');
    expect(() => db.exec(`
      INSERT INTO password_credentials (user_id, login, pass_hash)
      VALUES (601, 'out_of_range', 'encoded-hash-fixture')
    `)).toThrow();
  });
});

describe('password identity ID allocation', () => {
  it('retries an atomic primary-key collision and can issue both interval endpoints', async () => {
    addPasswordIdentity(PASSWORD_USER_ID_MIN, 'existing');
    vi.spyOn(crypto, 'getRandomValues')
      .mockImplementationOnce((buffer) => buffer.fill(0))
      .mockImplementationOnce((buffer) => buffer.fill(0xffffffff));

    const insert = vi.fn(async (id) => db.prepare(`
      INSERT INTO password_credentials (user_id, login, pass_hash)
      VALUES (?, 'allocated', 'encoded-hash-fixture')
      ON CONFLICT (user_id) DO NOTHING
    `).run(BigInt(id)).changes === 1);

    await expect(allocatePasswordUserId(insert)).resolves.toBe(Number.MAX_SAFE_INTEGER);
    expect(insert.mock.calls).toEqual([[PASSWORD_USER_ID_MIN], [Number.MAX_SAFE_INTEGER]]);
  });

  it('bounds retries and propagates unrelated write errors', async () => {
    const duplicate = vi.fn(async () => false);
    await expect(allocatePasswordUserId(duplicate)).rejects.toThrow('PASSWORD_USER_ID_ALLOCATION_EXHAUSTED');
    expect(duplicate).toHaveBeenCalledTimes(8);

    const failed = vi.fn(async () => { throw new Error('UNRELATED_WRITE_ERROR'); });
    await expect(allocatePasswordUserId(failed)).rejects.toThrow('UNRELATED_WRITE_ERROR');
    expect(failed).toHaveBeenCalledTimes(1);
  });
});

describe('existing Telegram account backfill', () => {
  const operatorSql = (file) => readFileSync(
    new URL(`../../tools/cloudflare/password-credentials/${file}`, import.meta.url), 'utf8',
  );
  const preview = () => db.prepare(operatorSql('preview.sql')).get();
  const backfill = () => db.exec(operatorSql('backfill.sql'));

  it('previews aggregate conflicts and only fills missing identities on each run', async () => {
    const linked = addTelegramAccount(701, 'Profile');
    addPasswordIdentity(PASSWORD_USER_ID_MIN, 'keep_me');
    db.prepare('UPDATE password_credentials SET app_user_id = ? WHERE user_id = ?')
      .run(linked.id, BigInt(PASSWORD_USER_ID_MIN));
    addTelegramAccount(702, 'Available');
    addTelegramAccount(703, 'Keep_Me');
    addTelegramAccount(704, 'Duplicate');
    addTelegramAccount(705, 'DUPLICATE');
    addTelegramAccount(706);

    expect(preview()).toEqual({
      total_telegram_accounts: 6, pending_accounts: 5, invalid_telegram_ids: 0, user_id_conflicts: 0,
      missing_or_invalid_logins: 1, conflicting_logins: 3, available_logins: 1,
    });
    backfill();
    backfill();

    expect(preview().pending_accounts).toBe(0);
    expect(await credentials.resolveByVerifiedTelegramId(701)).toMatchObject({
      userId: PASSWORD_USER_ID_MIN, login: 'keep_me', passwordConfigured: true,
    });
    expect(await credentials.getByUserId(702)).toMatchObject({ login: 'available', passwordConfigured: false });
    expect(await credentials.getByUserId(705)).toMatchObject({ login: null });
  });

  it.each(['0803', '4503599627370496'])('rolls back the whole insert on invalid Telegram ID %s', async (id) => {
    addTelegramAccount(801);
    addTelegramAccount(id);
    expect(preview().invalid_telegram_ids).toBe(1);
    expect(backfill).toThrow();
    expect(await credentials.getByUserId(801)).toBeNull();
  });

  it('rolls back the whole insert on a conflicting user ID', async () => {
    const owner = addTelegramAccount(901);
    addTelegramAccount(902);
    addTelegramAccount(903);
    db.prepare('INSERT INTO password_credentials (user_id, app_user_id) VALUES (903, ?)').run(owner.id);

    expect(preview().user_id_conflicts).toBe(1);
    expect(backfill).toThrow();
    expect(await credentials.getByUserId(902)).toBeNull();
    expect(await credentials.getByUserId(903)).toMatchObject({ appUserId: owner.id });
  });
});
