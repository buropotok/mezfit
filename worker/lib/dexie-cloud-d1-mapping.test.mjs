import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { handleDexieCloudTokenRoute } from './dexie-cloud-tokens';

const TELEGRAM_ID = 1234567;
const rawInitData = new URLSearchParams({
  auth_date: String(Math.floor(Date.now() / 1000)),
  user: JSON.stringify({ id: TELEGRAM_ID, first_name: 'Test' }),
});
const env = {
  TELEGRAM_BOT_TOKEN: '123:fixture',
  DEXIE_CLOUD_CLIENT_ID: 'fixture-id',
  DEXIE_CLOUD_CLIENT_SECRET: 'fixture-secret',
  MEZFIT_DEXIE_D1_MAPPING_ENABLED: 'true',
};
const key = createHmac('sha256', 'WebAppData').update(env.TELEGRAM_BOT_TOKEN).digest();
const check = [...rawInitData].map(([name, value]) => name + '=' + value).join('\n');
rawInitData.set('hash', createHmac('sha256', key).update(check).digest('hex'));

let db;
let binding;
let upstream;

function request(initData = rawInitData.toString()) {
  return new Request('https://mezfit.example/api/dexie-cloud/tokens', {
    method: 'POST',
    headers: { 'x-telegram-init-data': initData },
    body: JSON.stringify({ public_key: 'fixture-device-key', userId: '999', telegramUserId: '999' }),
  });
}

function addAccount() {
  db.prepare('INSERT INTO app_user (id, telegram_user_id, first_name) VALUES (42, ?, ?)').run(String(TELEGRAM_ID), 'Test');
}

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  for (const file of [
    '0001_users_and_roles.sql', '0033_account_replication_outbox.sql', '0034_account_replication_diagnostics.sql',
    '0036_password_credentials.sql', '0037_unify_account_replication.sql',
  ]) db.exec(readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8'));
  binding = { prepare: vi.fn((sql) => {
    const statement = db.prepare(sql);
    return {
      bind: (...args) => ({
        first: async () => statement.get(...args) ?? null,
        run: async () => statement.run(...args),
      }),
    };
  }) };
  upstream = vi.fn(async (_url, options) => {
    const { claims } = JSON.parse(options.body);
    return Response.json({
      type: 'tokens', accessToken: 'fixture-token', accessTokenExpiration: 60,
      userType: 'client', claims,
    });
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  db.close();
});

it('without the server flag uses the existing exchange without touching D1', async () => {
  const reply = await handleDexieCloudTokenRoute(request(), {
    ...env, DB_BINDING: binding, MEZFIT_DEXIE_D1_MAPPING_ENABLED: undefined,
  }, upstream);
  expect(reply.status).toBe(200);
  expect(binding.prepare).not.toHaveBeenCalled();
  expect((await reply.json()).claims.sub).toBe(`tg:${TELEGRAM_ID}`);
});

it('prepares one mapping for an existing account and keeps the exact subject for concurrent requests', async () => {
  addAccount();
  const exchange = () => handleDexieCloudTokenRoute(request(), { ...env, DB_BINDING: binding }, upstream);
  const replies = await Promise.all([exchange(), exchange()]);
  for (const reply of replies) {
    expect(reply.status).toBe(200);
    expect((await reply.json()).claims.sub).toBe(`tg:${TELEGRAM_ID}`);
  }
  expect(db.prepare('SELECT user_id, app_user_id, pass_hash FROM password_credentials').all()).toEqual([
    { user_id: TELEGRAM_ID, app_user_id: 42, pass_hash: null },
  ]);
  expect(db.prepare('SELECT revision, full_snapshot FROM account_replication_outbox').get())
    .toEqual({ revision: 2, full_snapshot: 1 });
  expect(JSON.parse(upstream.mock.calls[0][1].body)).toMatchObject({
    claims: { sub: `tg:${TELEGRAM_ID}` },
    public_key: 'fixture-device-key',
    scopes: ['ACCESS_DB'],
  });
});

it('does not register accounts from the token endpoint or fall back if D1 fails', async () => {
  const exchange = () => handleDexieCloudTokenRoute(request(), { ...env, DB_BINDING: binding }, upstream);
  expect((await exchange()).status).toBe(503);
  expect(db.prepare('SELECT id FROM app_user').all()).toEqual([]);
  binding.prepare.mockImplementation(() => { throw new Error('private D1 details'); });
  const reply = await exchange();
  expect(reply.status).toBe(503);
  expect(await reply.json()).toEqual({
    error: { code: 'DEXIE_CLOUD_UNAVAILABLE', message: 'Cloud authentication failed' },
  });
  expect(upstream).not.toHaveBeenCalled();
  expect(console.warn).toHaveBeenCalledWith('DEXIE_CLOUD_ACCOUNT_MAPPING_UNAVAILABLE');
});

it.each([100, 4503599627370496])('refuses conflicting or reserved mapping %s without deriving a subject', async id => {
  addAccount();
  db.prepare('INSERT INTO password_credentials (user_id, app_user_id) VALUES (CAST(? AS INTEGER), 42)').run(String(id));
  const reply = await handleDexieCloudTokenRoute(request(), { ...env, DB_BINDING: binding }, upstream);
  expect(reply.status).toBe(503);
  expect(upstream).not.toHaveBeenCalled();
});

it('verifies Telegram before looking up anything in D1', async () => {
  const tampered = new URLSearchParams(rawInitData);
  tampered.set('user', JSON.stringify({ id: 999, first_name: 'Test' }));
  const reply = await handleDexieCloudTokenRoute(request(tampered.toString()), { ...env, DB_BINDING: binding }, upstream);
  expect(reply.status).toBe(401);
  expect(binding.prepare).not.toHaveBeenCalled();
  expect(upstream).not.toHaveBeenCalled();
});

it('does not recreate a deleted mapping even if the Telegram profile still exists', async () => {
  addAccount();
  db.prepare('INSERT INTO password_credentials (user_id, app_user_id) VALUES (CAST(? AS INTEGER), 42)')
    .run(String(TELEGRAM_ID));
  db.exec('DELETE FROM password_credentials');

  const reply = await handleDexieCloudTokenRoute(request(), { ...env, DB_BINDING: binding }, upstream);
  expect(reply.status).toBe(503);
  expect(db.prepare('SELECT user_id FROM password_credentials').all()).toEqual([]);
  expect(upstream).not.toHaveBeenCalled();
});
