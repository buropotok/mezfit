'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, generateKeyPairSync, randomBytes, sign } = require('node:crypto');
const { handler } = require('./index.js');

test('signed popup tokens report the failing claim without revealing its value', async t => {
  const host = 'mezfit.online';
  const issuer = 'https://oauth.telegram.org';
  const bucket = 'mezfit-telegram-jwks-testfolder';
  const source = issuer + '/.well-known/jwks.json';
  const originalFetch = global.fetch;
  const originalWarn = console.warn;
  t.after(() => { global.fetch = originalFetch; console.warn = originalWarn; });
  Object.assign(process.env, {
    TG_OIDC_CLIENT_ID: '123456789',
    TG_OIDC_CLIENT_SECRET: 'test-client-secret',
    MEZFIT_BROWSER_SESSION_SECRET: randomBytes(32).toString('base64url'),
    MEZFIT_AUTH_HOSTS: host,
    MEZFIT_BROWSER_CHALLENGE_BUCKET: 'mezfit-browser-nonce-abcdef0123456789',
    MEZFIT_BROWSER_JWKS_BUCKET: bucket,
  });

  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = 'oidc-1';
  const jwks = JSON.stringify({ keys: [{ ...pair.publicKey.export({ format: 'jwk' }), kid }] });
  let nonceWrites = 0;
  global.fetch = async url => {
    if (url === `https://storage.yandexcloud.net/${bucket}/jwks.json`) return new Response(jwks);
    if (url === `https://storage.yandexcloud.net/${bucket}/status.json`) {
      return Response.json({ source, checkedAt: new Date().toISOString(),
        jwksSha256: createHash('sha256').update(jwks).digest('hex') });
    }
    nonceWrites += 1;
    return new Response();
  };
  const warnings = [];
  console.warn = line => { warnings.push(JSON.parse(line)); };
  const post = (path, body, cookie = '') => ({
    path, httpMethod: 'POST', body: JSON.stringify(body),
    headers: { host, origin: `https://${host}`, cookie, 'content-type': 'application/json' },
  });
  const context = { token: { access_token: 'test-runtime-token' } };
  const now = Math.floor(Date.now() / 1000);

  for (const [changes, code] of [
    [{ iss: 'private-issuer' }, 'claims_issuer_mismatch'],
    [{ aud: 'private-audience' }, 'claims_audience_mismatch'],
    [{ sub: '' }, 'claims_subject_invalid'],
    [{ id: 'private-telegram-id' }, 'claims_telegram_id_invalid'],
    [{ exp: 'private-exp' }, 'claims_exp_invalid'],
    [{ exp: now - 5 }, 'claims_token_expired'],
    [{ iat: 'private-iat' }, 'claims_iat_invalid'],
    [{ iat: now + 180 }, 'claims_iat_in_future'],
    [{ iat: now - 700 }, 'claims_iat_too_old'],
    [{ nonce: undefined }, 'claims_nonce_missing'],
    [{ nonce: 'private-unrelated-nonce' }, 'claims_nonce_mismatch'],
  ]) {
    const start = await handler(post('/auth/start', {}));
    assert.equal(start.statusCode, 200);
    const { nonce } = JSON.parse(start.body);
    const cookie = start.multiValueHeaders['Set-Cookie'][0].split(';')[0];
    const payload = { iss: issuer, aud: '123456789', sub: 'private-subject',
      id: 123, iat: now, exp: now + 300, nonce, ...changes };
    const input = [{ alg: 'RS256', kid }, payload]
      .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
    const idToken = input + '.' + sign('RSA-SHA256', Buffer.from(input), pair.privateKey).toString('base64url');
    const response = await handler(post('/auth/callback', { idToken }, cookie), context);
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 401);
    assert.equal(response.multiValueHeaders['Set-Cookie'].length, 1);
    assert.match(body.incidentId, /^[\w-]{16}$/);
    assert.deepEqual(body, { error: 'TELEGRAM_LOGIN_VERIFICATION_FAILED',
      incidentId: body.incidentId, stage: 'jwt', code });
    assert.deepEqual(warnings.pop(), { event: 'mezfit.browser_oidc.failure',
      incidentId: body.incidentId, stage: 'jwt', code });
  }
  assert.equal(nonceWrites, 0);
});
