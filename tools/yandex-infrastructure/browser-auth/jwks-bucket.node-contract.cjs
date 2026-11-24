'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, generateKeyPairSync, randomBytes, sign } = require('node:crypto');
const { handler } = require('./index.js');

const issuer = 'https://oauth.telegram.org';
const host = 'mezfit.online';
const clientId = '123456789';
const context = { token: { access_token: 'runtime-iam-token' } };
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const key = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'oidc-1', alg: 'RS256', use: 'sig' };
const jwks = JSON.stringify({ keys: [key, { kid: 'another-algorithm', kty: 'OKP', alg: 'EdDSA' }] });
Object.assign(process.env, {
  TG_OIDC_CLIENT_ID: clientId,
  TG_OIDC_CLIENT_SECRET: 'test-client-secret',
  MEZFIT_BROWSER_SESSION_SECRET: randomBytes(32).toString('base64url'),
  MEZFIT_AUTH_HOSTS: host,
  MEZFIT_BROWSER_CHALLENGE_BUCKET: 'mezfit-browser-nonce-abcdef0123456789',
  MEZFIT_BROWSER_JWKS_BUCKET: 'mezfit-telegram-jwks-testfolder',
});

function post(path, payload, cookie = '') {
  return { path, httpMethod: 'POST', body: JSON.stringify(payload), headers: {
    host, origin: `https://${host}`, 'content-type': 'application/json', cookie,
  } };
}

async function signIn() {
  const start = await handler(post('/auth/start', {}));
  assert.equal(start.statusCode, 200);
  const { nonce } = JSON.parse(start.body);
  const cookie = start.multiValueHeaders['Set-Cookie'][0].split(';')[0];
  const iat = Math.floor(Date.now() / 1000);
  const token = [{ alg: 'RS256', kid: key.kid }, {
    iss: issuer, sub: 'telegram-user', id: 123, aud: clientId, nonce, iat, exp: iat + 120,
  }].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
  const signature = sign('RSA-SHA256', Buffer.from(token), pair.privateKey).toString('base64url');
  return handler(post('/auth/callback', { idToken: token + '.' + signature }, cookie), context);
}

test('popup uses the private mirror, rejecting stale or mismatched objects before issuing a session', async t => {
  const originalFetch = global.fetch;
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  t.after(() => { global.fetch = originalFetch; Date.now = originalNow; });
  const checkedAt = now;
  let statusReads = 0;
  let nonceWrites = 0;
  let health = 'stale';
  global.fetch = async (url, options) => {
    const base = 'https://storage.yandexcloud.net/mezfit-telegram-jwks-testfolder';
    assert.equal(options.headers.Authorization, 'Bearer runtime-iam-token');
    if (url === base + '/status.json') {
      statusReads += 1;
      return Response.json({
        source: issuer + '/.well-known/jwks.json',
        checkedAt: new Date(health === 'stale' ? now - 301_000 : checkedAt).toISOString(),
        jwksSha256: health === 'mismatch' ? '0'.repeat(64) : createHash('sha256').update(jwks).digest('hex'),
      });
    }
    if (url === base + '/jwks.json') return new Response(jwks);
    assert.match(url, /^https:\/\/storage\.yandexcloud\.net\/mezfit-browser-nonce-abcdef0123456789\/used\/[a-f0-9]{64}$/);
    assert.equal(options.method, 'PUT');
    assert.equal(options.headers['If-None-Match'], '*');
    nonceWrites += 1;
    return new Response();
  };

  for (const [mode, code, reads] of [['stale', 'mirror_stale', 1], ['mismatch', 'mirror_digest_mismatch', 3]]) {
    health = mode;
    const failure = await signIn();
    assert.equal(failure.statusCode, 401);
    assert.equal(JSON.parse(failure.body).code, code);
    assert.equal(failure.multiValueHeaders['Set-Cookie'].length, 1);
    assert.equal(statusReads, reads);
    assert.equal(nonceWrites, 0);
  }

  health = 'fresh';
  now = checkedAt + 290_000;
  assert.equal((await signIn()).statusCode, 200);
  assert.equal((await signIn()).statusCode, 200);
  assert.equal(statusReads, 4);
  assert.equal(nonceWrites, 2);
  now = checkedAt + 301_000;
  const expired = await signIn();
  assert.equal(JSON.parse(expired.body).code, 'mirror_stale');
  assert.equal(nonceWrites, 2);
});
