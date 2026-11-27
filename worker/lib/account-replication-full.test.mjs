import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { deliverAccountReplicas } from './account-replication';

const KEY = '9007199254740991';
const FIXTURE = '$argon2id$v=19$m=65536,t=3,p=1$' + 'A'.repeat(22) + '$' + 'B'.repeat(43);
let db;
let env;

function row(key) {
  return db.prepare('SELECT * FROM account_replication_outbox WHERE telegram_user_id = ?').get(key);
}

function passwordAccount() {
  db.prepare(`
    INSERT INTO password_credentials (user_id, login, pass_hash) VALUES (CAST(? AS INTEGER), 'example', ?)
  `).run(KEY, FIXTURE);
}

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  for (const file of [
    '0001_users_and_roles.sql', '0033_account_replication_outbox.sql', '0034_account_replication_diagnostics.sql',
    '0036_password_credentials.sql', '0037_unify_account_replication.sql',
  ]) db.exec(readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8'));
  env = {
    MEZFIT_ACCOUNT_REPLICATION_SECRET: 'fixture',
    DB_BINDING: { prepare(sql) {
      const statement = db.prepare(sql);
      return {
        bind: (...args) => ({
          all: async () => ({ results: statement.all(...args) }),
          run: async () => ({ meta: statement.run(...args) }),
        }),
      };
    } },
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  db.close();
});

it('coalesces profile, role and password writes into one durable full revision', async () => {
  db.exec("INSERT INTO app_user (telegram_user_id, first_name) VALUES ('101', 'Before')");
  db.exec("INSERT INTO password_credentials (user_id, app_user_id, login) VALUES (101, 1, 'example')");
  db.exec("UPDATE app_user SET first_name = 'Current' WHERE id = 1");
  db.exec("INSERT INTO user_role (user_id, role) VALUES (1, 'client')");
  expect(row('101')).toMatchObject({ revision: 4, full_snapshot: 1 });
  expect(db.prepare('SELECT count(*) AS total FROM account_replication_outbox').get().total).toBe(1);
  expect(() => db.exec('UPDATE account_replication_outbox SET next_attempt_at = NULL')).toThrow();

  const send = vi.fn(async (_url, request) => {
    expect(JSON.parse(request.body)).toMatchObject({
      revision: 4, user: { firstName: 'Current', telegramUserId: '101', isPremium: false }, roles: ['client'],
      identity: { userId: '101', telegramId: '101', login: 'example', passHash: null, state: 'active' },
    });
    db.exec('UPDATE password_credentials SET login = NULL WHERE user_id = 101');
    return Response.json({ status: 'applied', revision: 4 });
  });
  vi.stubGlobal('fetch', send);
  await deliverAccountReplicas(env);
  expect(send).toHaveBeenCalledTimes(1);
  expect(row('101')).toMatchObject({ revision: 5, next_attempt_at: expect.any(Number), full_ack_revision: null });
});

it('replicates a password-only account at the safe integer boundary and its later deletion', async () => {
  const received = [];
  vi.stubGlobal('fetch', async (_url, request) => {
    const snapshot = JSON.parse(request.body);
    received.push(snapshot);
    return Response.json({ status: 'applied', revision: snapshot.revision });
  });

  db.exec('BEGIN');
  passwordAccount();
  db.exec('ROLLBACK');
  expect(row(KEY)).toBeUndefined();
  passwordAccount();
  await deliverAccountReplicas(env);
  db.exec('DELETE FROM password_credentials');
  await deliverAccountReplicas(env);
  expect(received).toEqual([
    {
      revision: 1, user: null, roles: [],
      identity: { userId: KEY, telegramId: null, login: 'example', passHash: FIXTURE, state: 'active' },
    },
    {
      revision: 2, user: null, roles: [],
      identity: { userId: KEY, telegramId: null, login: null, passHash: null, state: 'deleted' },
    },
  ]);
  expect(row(KEY)).toMatchObject({ revision: 2, next_attempt_at: null, full_ack_revision: 2 });
});

it('does not treat another revision as acknowledgement for the full snapshot', async () => {
  passwordAccount();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('fetch', async () => Response.json({ status: 'stale', revision: 2 }));
  await deliverAccountReplicas(env);
  expect(row(KEY)).toMatchObject({ revision: 1, attempts: 1, last_error: 'INVALID_ACKNOWLEDGEMENT' });
});

it('keeps the permanent key after Telegram linking and delivers profile edits on that key', async () => {
  passwordAccount();
  db.exec("INSERT INTO app_user (telegram_user_id, first_name) VALUES ('202', 'Before')");
  db.exec("UPDATE password_credentials SET app_user_id = 1");
  db.exec("UPDATE app_user SET first_name = 'Current' WHERE id = 1");
  const received = [];
  vi.stubGlobal('fetch', async (_url, request) => {
    const snapshot = JSON.parse(request.body);
    received.push(snapshot);
    return Response.json({ status: 'applied', revision: snapshot.revision });
  });
  await deliverAccountReplicas(env, '202');
  expect(received).toMatchObject([{
    revision: 3, user: { firstName: 'Current' },
    identity: { userId: KEY, telegramId: '202', state: 'active' },
  }]);
  await deliverAccountReplicas(env);
  expect(received[1]).toMatchObject({
    user: null, identity: { userId: '202', telegramId: null, state: 'deleted' },
  });
});
