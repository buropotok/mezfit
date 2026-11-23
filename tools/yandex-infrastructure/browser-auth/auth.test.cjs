'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, generateKeyPairSync, randomBytes, sign } = require('node:crypto');
const { handler, _test } = require('./index.js');

const HOST = 'mezfit.online';
const CLIENT_ID = '123456789';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid: 'telegram-key', alg: 'RS256', use: 'sig' };

process.env.TG_OIDC_CLIENT_ID = CLIENT_ID;
process.env.TG_OIDC_CLIENT_SECRET = 'test-client-secret';
process.env.MEZFIT_BROWSER_SESSION_SECRET = randomBytes(32).toString('base64url');
process.env.MEZFIT_AUTH_HOSTS = HOST + ',mezfit.ru,d5example.apigw.yandexcloud.net';

const now = () => Math.floor(Date.now() / 1000);
const cookiePair = raw => raw.split(';', 1)[0];
const events = (path, method = 'GET', headers = {}, params = {}) => ({
  path, httpMethod: method, headers: { Host: HOST, ...headers },
  queryStringParameters: params,
});

function jwt(nonce, overrides = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'telegram-key' })).toString('base64url');
  const data = Buffer.from(JSON.stringify({
    iss: 'https://oauth.telegram.org', aud: CLIENT_ID,
    sub: 'opaque-telegram-oidc-subject', id: 208192415,
    name: 'Example User', preferred_username: 'example',
    nonce, iat: now(), exp: now() + 3600, ...overrides,
  })).toString('base64url');
  const signature = sign('RSA-SHA256', Buffer.from(header + '.' + data), privateKey).toString('base64url');
  return [header, data, signature].join('.');
}

function stubTelegram(token, onExchange = () => {}) {
  const original = global.fetch;
  global.fetch = async (url, init = {}) => {
    if (url === 'https://oauth.telegram.org/token') {
      onExchange(init);
      return new Response(JSON.stringify({ id_token: token }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url === 'https://oauth.telegram.org/.well-known/jwks.json') {
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error('Unexpected outbound URL');
  };
  return () => { global.fetch = original; };
}

test('browser login starts with exact callback, state, nonce, S256 and strict cookie', async () => {
  const start = await handler(events('/auth/start'));
  assert.equal(start.statusCode, 302);
  const url = new URL(start.headers.Location);
  assert.equal(url.origin, 'https://oauth.telegram.org');
  assert.equal(url.searchParams.get('client_id'), CLIENT_ID);
  assert.equal(url.searchParams.get('redirect_uri'), 'https://mezfit.online/auth/callback');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('scope'), 'openid profile');
  assert.match(start.multiValueHeaders['Set-Cookie'][0], /^__Host-mz_oidc_flow=/);
  assert.match(start.multiValueHeaders['Set-Cookie'][0], /Secure; HttpOnly; SameSite=Lax; Max-Age=600/);
  assert.ok(url.searchParams.get('state'));
  assert.ok(url.searchParams.get('nonce'));
  assert.equal(start.headers['Cache-Control'], 'no-store');
});

test('validated Telegram OIDC ID token issues host-bound browser session', async () => {
  const start = await handler(events('/auth/start'));
  const flowCookie = cookiePair(start.multiValueHeaders['Set-Cookie'][0]);
  const authorize = new URL(start.headers.Location);
  const nonce = authorize.searchParams.get('nonce');
  let sawPkce = false;
  const restore = stubTelegram(jwt(nonce), request => {
    assert.match(request.headers.Authorization, /^Basic /);
    const fields = new URLSearchParams(request.body);
    assert.equal(fields.get('code'), 'auth-code-123456');
    assert.equal(fields.get('redirect_uri'), 'https://mezfit.online/auth/callback');
    const pkce = createHash('sha256').update(fields.get('code_verifier')).digest('base64url');
    assert.equal(pkce, authorize.searchParams.get('code_challenge'));
    sawPkce = true;
  });
  try {
    const callback = await handler(events('/auth/callback', 'GET',
      { Cookie: flowCookie }, {
        code: 'auth-code-123456', state: authorize.searchParams.get('state'),
      }));
    assert.equal(callback.statusCode, 302);
    assert.equal(callback.headers.Location, '/');
    assert.equal(callback.multiValueHeaders['Set-Cookie'].length, 2);
    const sessionCookie = cookiePair(callback.multiValueHeaders['Set-Cookie'][1]);
    assert.match(sessionCookie, /^__Host-mz_browser_session=/);

    const response = await handler(events('/auth/session', 'GET', { Cookie: sessionCookie }));
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      authenticated: true, telegramUserId: '208192415',
      name: 'Example User', username: 'example',
    });
    assert.equal(sawPkce, true);
    const crossDomain = await handler(events('/auth/session', 'GET',
      { Host: 'mezfit.ru', Cookie: sessionCookie }));
    assert.equal(crossDomain.statusCode, 401);
  } finally {
    restore();
  }
});

test('callback rejects mismatched state before any network call', async () => {
  const start = await handler(events('/auth/start'));
  const flowCookie = cookiePair(start.multiValueHeaders['Set-Cookie'][0]);
  const callback = await handler(events('/auth/callback', 'GET',
    { Cookie: flowCookie }, { code: 'auth-code-123456', state: 'wrong-state' }));
  assert.equal(callback.statusCode, 401);
});

test('callback rejects a forged signature and never issues session', async () => {
  const start = await handler(events('/auth/start'));
  const authorize = new URL(start.headers.Location);
  const forged = jwt(authorize.searchParams.get('nonce'));
  const parts = forged.split('.');
  parts[1] = Buffer.from(JSON.stringify({
    iss: 'https://oauth.telegram.org', aud: CLIENT_ID, sub: 'changed',
    id: 1, nonce: authorize.searchParams.get('nonce'),
    iat: now(), exp: now() + 100,
  })).toString('base64url');
  const restore = stubTelegram(parts.join('.'));
  try {
    const response = await handler(events('/auth/callback', 'GET',
      { Cookie: cookiePair(start.multiValueHeaders['Set-Cookie'][0]) }, {
        code: 'auth-code-123456', state: authorize.searchParams.get('state'),
      }));
    assert.equal(response.statusCode, 401);
    assert.equal(response.multiValueHeaders['Set-Cookie'].length, 1);
  } finally { restore(); }
});

test('callback rejects signed tokens with wrong nonce, audience and expired claims', async () => {
  for (const overrides of (
    [{ nonce: 'bad' }, { aud: 'unrelated-client' }, { exp: now() - 1 }, { iss: 'https://evil.example' }]
  )) {
    const start = await handler(events('/auth/start'));
    const authorize = new URL(start.headers.Location);
    const restore = stubTelegram(jwt(authorize.searchParams.get('nonce'), overrides));
    try {
      const response = await handler(events('/auth/callback', 'GET',
        { Cookie: cookiePair(start.multiValueHeaders['Set-Cookie'][0]) }, {
          code: 'auth-code-123456', state: authorize.searchParams.get('state'),
        }));
      assert.equal(response.statusCode, 401, JSON.stringify(overrides));
    } finally { restore(); }
  }
});

test('session tokens cannot be forged, extended or used across hosts', async () => {
  const config = _test.configuration();
  const base = { version: 1, host: HOST, sub: 'opaque', telegramUserId: 123,
    iat: now(), exp: now() + 600 };
  const signed = _test.signed(base, config.key);
  const response = await handler(events('/auth/session', 'GET',
    { Cookie: '__Host-mz_browser_session=' + signed }));
  assert.equal(response.statusCode, 200);
  const [body, mac] = signed.split('.');
  const tampered = body + '.' + (mac[0] === 'A' ? 'B' : 'A') + mac.slice(1);
  assert.equal((await handler(events('/auth/session', 'GET',
    { Cookie: '__Host-mz_browser_session=' + tampered }))).statusCode, 401);
  for (const override of [{ exp: now() - 1 }, { exp: now() + 100000 }, { host: 'mezfit.ru' }]) {
    const value = _test.signed({ ...base, ...override }, config.key);
    assert.equal((await handler(events('/auth/session', 'GET',
      { Cookie: '__Host-mz_browser_session=' + value }))).statusCode, 401);
  }
});

test('logout is POST-only and requires exact same origin', async () => {
  assert.equal((await handler(events('/auth/logout', 'GET'))).statusCode, 405);
  assert.equal((await handler(events('/auth/logout', 'POST',
    { Origin: 'https://evil.example' }))).statusCode, 403);
  const result = await handler(events('/auth/logout', 'POST',
    { Origin: 'https://mezfit.online' }));
  assert.equal(result.statusCode, 200);
  assert.equal(result.multiValueHeaders['Set-Cookie'].length, 2);
  assert.ok(result.multiValueHeaders['Set-Cookie'].every(c => c.includes('Max-Age=0')));
});

test('unauthorized host, missing config and protected /api paths fail closed', async () => {
  assert.equal((await handler(events('/auth/start', 'GET', { Host: 'evil.example' }))).statusCode, 403);
  assert.equal((await handler(events('/api/me'))).statusCode, 404);
  const old = process.env.TG_OIDC_CLIENT_SECRET;
  delete process.env.TG_OIDC_CLIENT_SECRET;
  try {
    assert.equal((await handler(events('/auth/start'))).statusCode, 503);
  } finally {
    process.env.TG_OIDC_CLIENT_SECRET = old;
  }
});
