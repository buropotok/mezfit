import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deliverAccountReplicas } from './account-replication';

const loadMigration = (file) => readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8');

let db;
let env;

function insertAccount() {
  db.exec("INSERT INTO app_user (telegram_user_id, first_name) VALUES ('101', 'Test')");
}

function outbox() {
  return { ...db.prepare('SELECT * FROM account_replication_outbox').get() };
}

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(loadMigration('0001_users_and_roles.sql'));
  db.exec(loadMigration('0033_account_replication_outbox.sql'));
  const prepare = (sql) => {
    const statement = db.prepare(sql);
    return {
      bind: (...args) => ({
        all: async () => ({ results: statement.all(...args) }),
        run: async () => ({ meta: statement.run(...args) }),
      }),
    };
  };
  env = { DB_BINDING: { prepare }, MEZFIT_ACCOUNT_REPLICATION_SECRET: 'test-secret' };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  db.close();
});

describe('account replication', () => {
  it('tracks actual profile and role changes in the same transaction', () => {
    insertAccount();
    expect(outbox().revision).toBe(1);
    db.exec("UPDATE app_user SET first_name = 'Test' WHERE id = 1");
    expect(outbox().revision).toBe(1);

    db.exec("BEGIN; INSERT INTO user_role (user_id, role) VALUES (1, 'client')");
    expect(outbox().revision).toBe(2);
    db.exec('ROLLBACK');
    expect(outbox().revision).toBe(1);

    db.exec("INSERT OR IGNORE INTO user_role (user_id, role) VALUES (1, 'coach')");
    db.exec("INSERT OR IGNORE INTO user_role (user_id, role) VALUES (1, 'coach')");
    expect(outbox().revision).toBe(2);
    db.exec("UPDATE app_user SET first_name = 'Updated' WHERE id = 1");
    db.exec("DELETE FROM user_role WHERE user_id = 1 AND role = 'coach'");
    expect(outbox().revision).toBe(4);
  });

  it('acknowledges only the revision it sent and preserves the version after delivery', async () => {
    insertAccount();
    db.exec("INSERT INTO user_role (user_id, role) VALUES (1, 'client')");
    const send = vi.fn()
      .mockImplementationOnce(async (url, request) => {
        expect(url).toBe('https://mezfit.online/api/internal/account-replication');
        expect(request.method).toBe('POST');
        expect(request.redirect).toBe('error');
        expect(request.headers.authorization).toBe('Bearer test-secret');
        expect(JSON.parse(request.body)).toEqual({
          user: {
            id: 1, telegramUserId: '101', username: null, firstName: 'Test',
            lastName: null, languageCode: null, photoUrl: null, isPremium: false,
          },
          roles: ['client'],
          revision: 2,
        });
        db.exec("INSERT INTO user_role (user_id, role) VALUES (1, 'coach')");
        return Response.json({ status: 'applied', revision: 2 });
      })
      .mockImplementationOnce(async (_url, request) => {
        expect(JSON.parse(request.body)).toMatchObject({ roles: ['client', 'coach'], revision: 3 });
        return Response.json({ status: 'duplicate', revision: 3 });
      });
    vi.stubGlobal('fetch', send);

    await deliverAccountReplicas(env, '101');
    expect(outbox()).toMatchObject({ revision: 3, next_attempt_at: expect.any(Number) });
    await deliverAccountReplicas(env);
    expect(outbox()).toMatchObject({ revision: 3, next_attempt_at: null });

    db.exec("UPDATE app_user SET first_name = 'Updated' WHERE id = 1");
    expect(outbox()).toMatchObject({ revision: 4, attempts: 0, next_attempt_at: expect.any(Number) });
  });

  it('retries an invalid acknowledgement without advancing the revision', async () => {
    insertAccount();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const send = vi.fn()
      .mockResolvedValueOnce(Response.json({ status: 'applied', revision: 2 }))
      .mockResolvedValueOnce(Response.json({ status: 'applied', revision: 1 }));
    vi.stubGlobal('fetch', send);
    const before = Date.now();

    await deliverAccountReplicas(env);
    expect(outbox()).toMatchObject({ revision: 1, attempts: 1, last_error: 'INVALID_ACKNOWLEDGEMENT' });
    expect(outbox().next_attempt_at).toBeGreaterThanOrEqual(before + 5 * 60_000);
    await deliverAccountReplicas(env);
    expect(send).toHaveBeenCalledTimes(1);

    db.exec('UPDATE account_replication_outbox SET next_attempt_at = 0');
    await deliverAccountReplicas(env);
    expect(outbox()).toMatchObject({ revision: 1, next_attempt_at: null, last_error: null });
  });
});
