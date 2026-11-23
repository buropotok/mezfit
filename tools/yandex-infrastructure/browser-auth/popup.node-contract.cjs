'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, randomBytes, sign } = require('node:crypto');
const { handler, _test } = require('./index.js');

const host = 'mezfit.online';
const issuer = 'https://oauth.telegram.org';
const clientId = '123456789';
const bucket = 'mezfit-browser-nonce-abcdef0123456789';
const context = { token: { access_token: 'test-runtime-token' } };
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const key = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'active', alg: 'RS256', use: 'sig' };
process.env.TG_OIDC_CLIENT_ID = clientId;
process.env.TG_OIDC_CLIENT_SECRET = 'test-client-secret';
process.env.MEZFIT_BROWSER_SESSION_SECRET = randomBytes(32).toString('base64url');
process.env.MEZFIT_AUTH_HOSTS = `${host},mezfit.ru`;
process.env.MEZFIT_BROWSER_CHALLENGE_BUCKET = bucket;

function event(path, body, headers = {}) {
  return { path, httpMethod: 'POST', body: JSON.stringify(body), headers: {
    host, origin: `https://${host}`, 'content-type': 'application/json', ...headers,
  } };
}

function signToken(nonce, claims = {}, header = {}) {
  const now = Math.floor(Date.now() / 1000);
  const parts = [{ alg: 'RS256', kid: key.kid, ...header }, {
    iss: issuer, aud: clientId, sub: 'opaque', id: 123, nonce, iat: now, exp: now + 3600, ...claims,
  }].map(x => Buffer.from(JSON.stringify(x)).toString('base64url'));
  return [...parts, sign('RSA-SHA256', Buffer.from(parts.join('.')), keys.privateKey).toString('base64url')].join('.');
}

async function challenge() {
  const response = await handler(event('/auth/start', {}));
  assert.equal(response.statusCode, 200);
  const [cookie] = response.multiValueHeaders['Set-Cookie'];
  assert.match(cookie, /Secure; HttpOnly; SameSite=Lax; Max-Age=300/);
  const { nonce } = JSON.parse(response.body);
  return { nonce, cookie: cookie.split(';')[0] };
}

test('popup fails closed on JWKS timeout; a new attempt uses only JWKS and one conditional marker', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const written = new Set();
  let failJwks = true;
  global.fetch = async (url, options) => {
    if (url === `${issuer}/.well-known/jwks.json`) {
      if (failJwks) throw new DOMException('private upstream value', 'TimeoutError');
      return Response.json({ keys: [key] });
    }
    assert.match(url, new RegExp(`^https://storage\\.yandexcloud\\.net/${bucket}/used/[a-f0-9]{64}$`));
    assert.equal(options.method, 'PUT');
    assert.equal(options.body, '');
    assert.equal(options.headers['If-None-Match'], '*');
    assert.equal(options.headers.Authorization, 'Bearer test-runtime-token');
    if (written.has(url)) return new Response(null, { status: 412 });
    written.add(url);
    return new Response();
  };
  const first = await challenge();
  const failure = await handler(event('/auth/callback', { idToken: signToken(first.nonce) }, { cookie: first.cookie }), context);
  assert.equal(failure.statusCode, 401);
  assert.equal(JSON.parse(failure.body).stage, 'jwks');
  assert.equal(JSON.parse(failure.body).code, 'timeout');
  assert.equal(failure.multiValueHeaders['Set-Cookie'].length, 1);
  assert.equal(written.size, 0);
  assert.doesNotMatch(failure.body, /private upstream value/);

  failJwks = false;
  const attempt = await challenge();
  const callback = event('/auth/callback', { idToken: signToken(attempt.nonce) }, { cookie: attempt.cookie });
  const results = await Promise.all([handler(callback, context), handler(callback, context)]);
  const success = results.find(response => response.statusCode === 200);
  const replay = results.find(response => response.statusCode === 401);
  assert.ok(success && replay);
  assert.equal(written.size, 1);
  assert.equal(JSON.parse(replay.body).code, 'already_used');
  const sessionCookie = success.multiValueHeaders['Set-Cookie'][1].split(';')[0];
  const session = await handler({ path: '/auth/session', httpMethod: 'GET', headers: { host, cookie: sessionCookie } });
  assert.equal(JSON.parse(session.body).telegramUserId, '123');
  const logout = await handler(event('/auth/logout', {}, { cookie: sessionCookie }));
  assert.equal(logout.statusCode, 200);
  assert.ok(logout.multiValueHeaders['Set-Cookie'].every(cookie => cookie.includes('Max-Age=0')));

  const rejected = await challenge();
  for (const token of [undefined, signToken('wrong-nonce'), signToken(rejected.nonce, { id: 'forged' }),
    signToken(rejected.nonce, {}, { alg: 'none' }), signToken(rejected.nonce, { aud: 'different-app' }),
    signToken(rejected.nonce, { exp: 1 }), signToken(rejected.nonce, {}, { kid: 'unknown' }),
    signToken(rejected.nonce, { iss: 'https://example.invalid' }),
    signToken(rejected.nonce).replace(/\.[^.]+$/, '.AAAA')]) {
    const response = await handler(event('/auth/callback', { idToken: token }, { cookie: rejected.cookie }), context);
    assert.equal(response.statusCode, 401);
    assert.equal(response.multiValueHeaders['Set-Cookie'].length, 1);
  }
  const expired = _test.signed({ nonce: rejected.nonce, host, iat: Math.floor(Date.now() / 1000) - 301 },
    _test.configuration().key);
  const expiredResponse = await handler(event('/auth/callback', { idToken: signToken(rejected.nonce) }, {
    cookie: `__Host-mz_oidc_popup=${expired}`,
  }), context);
  assert.equal(JSON.parse(expiredResponse.body).code, 'invalid_or_expired');
  assert.equal(written.size, 1);
  assert.equal((await handler(event('/auth/start', {}, { origin: 'https://example.invalid' }))).statusCode, 403);
  assert.equal((await handler(event('/auth/start', {}, { host: 'example.invalid' }))).statusCode, 403);
  assert.equal((await handler(event('/auth/callback', { idToken: 'x'.repeat(13000) }))).statusCode, 400);
  assert.equal((await handler(event('/auth/callback', {}, { 'content-type': 'text/plain' }))).statusCode, 400);
});
