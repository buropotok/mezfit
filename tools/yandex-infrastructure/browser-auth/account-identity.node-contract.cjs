'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { _test: { handleBrowserRequest, signed, verified } } = require('./index.js');

const host = 'mezfit.online';
const id = 1234567;
const key = Buffer.alloc(32, 7);
const cookieName = '__Host-mz_browser_session';
const tokenPath = '/api/dexie-cloud/tokens';
const row = {
  user_id: String(id), external_telegram_id: String(id), identity_state: 'active', revision: '18',
  snapshot: JSON.stringify({ user: { id: 42, telegramUserId: String(id) }, roles: ['client'] }),
};

function event(path, version) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    version, host, sub: 'telegram-oidc-sub', telegramUserId: id,
    name: 'Test', username: 'example', iat: now - (version === 1 ? 10 : 86401), exp: now + 1000,
  };
  return {
    path, httpMethod: path === tokenPath ? 'POST' : 'GET',
    headers: { Host: host, Origin: 'https://' + host, Cookie: cookieName + '=' + signed(payload, key) },
    body: JSON.stringify({ public_key: 'fixture-device-key', userId: '999' }),
  };
}

function enable(t, fetch) {
  const env = {
    MEZFIT_BROWSER_SESSION_SECRET: key.toString('base64url'),
    MEZFIT_AUTH_HOSTS: host,
    TG_OIDC_CLIENT_ID: '12345',
    TG_OIDC_CLIENT_SECRET: 'fixture-oidc',
    MEZFIT_BROWSER_YDB_IDENTITY_ENABLED: 'true',
    DEXIE_CLOUD_DB_URL: 'https://mezfit-fixture.dexie.cloud',
    DEXIE_CLOUD_CLIENT_ID: 'fixture-id',
    DEXIE_CLOUD_CLIENT_SECRET: 'fixture-secret',
  };
  const previous = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  if (fetch) t.mock.method(globalThis, 'fetch', fetch);
  t.after(() => {
    for (const [k, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[k];
      else process.env[k] = value;
    }
  });
}

test('renews signed v1 and v2 cookies after checking the YDB mapping without a Telegram request', async t => {
  enable(t, () => assert.fail('session renewal should not make an HTTP request'));
  for (const v of [1, 2]) {
    const response = await handleBrowserRequest(event('/auth/session', v), {}, async telegramId => {
      assert.equal(telegramId, String(id));
      return [row];
    });
    assert.equal(response.statusCode, 200);
    const cookie = response.multiValueHeaders['Set-Cookie'][0].split(';')[0];
    const payload = verified(cookie.slice(cookieName.length + 1), key);
    assert.equal(payload.version, 2);
    assert.equal(payload.telegramUserId, id);
    assert.deepEqual(JSON.parse(response.body), {
      authenticated: true, telegramUserId: String(id), name: 'Test', username: 'example',
    });
  }
});

test('issues the established subject from exactly one complete YDB identity', async t => {
  let calls = 0;
  enable(t, async (url, options) => {
    calls++;
    assert.equal(url, 'https://mezfit-fixture.dexie.cloud/token');
    const body = JSON.parse(options.body);
    assert.equal(body.public_key, 'fixture-device-key');
    assert.deepEqual(body.scopes, ['ACCESS_DB']);
    assert.equal(body.claims.sub, 'tg:' + id);
    return Response.json({
      type: 'tokens', accessToken: 'fixture', accessTokenExpiration: 60, userType: 'client',
      claims: { sub: 'tg:' + id },
    });
  });
  const response = await handleBrowserRequest(event(tokenPath, 2), {}, async telegramId => {
    assert.equal(telegramId, String(id));
    return [row];
  });
  assert.equal(response.statusCode, 200);
  assert.equal(calls, 1);
});

test('rejects unavailable, ambiguous, synthetic and inconsistent snapshots without resetting the session', async t => {
  enable(t, () => assert.fail('Dexie must not be contacted'));
  for (const read of [
    async () => { throw new Error('fixture permission denied'); },
    async () => [],
    async () => [row, row],
    async () => [{ ...row, user_id: String(2 ** 52) }],
    async () => [{ ...row, identity_state: 'deleted' }],
    async () => [{ ...row, snapshot: '{"user":{"id":42,"telegramUserId":"1"}}' }],
    async () => [{ ...row, revision: '018' }],
  ]) {
    for (const path of [tokenPath, '/auth/session']) {
      const response = await handleBrowserRequest(
        event(path, 2), {}, read,
      );
      assert.equal(response.statusCode, 503);
      assert.equal(response.multiValueHeaders, undefined);
      assert.doesNotMatch(response.body, /fixture permission denied/);
    }
  }
});

test('rejects an untrusted browser origin without querying the replica', async t => {
  enable(t);
  const input = event(tokenPath, 2);
  input.headers.Origin = 'https://untrusted.example';
  const response = await handleBrowserRequest(input, {}, () => assert.fail('YDB must not be contacted'));
  assert.equal(response.statusCode, 403);
});
