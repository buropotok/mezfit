'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { handler, _test: { signed } } = require('./index.js');

const host = 'mezfit.online';
const path = '/api/dexie-cloud/tokens';
const dbUrl = 'https://test.dexie.cloud';
const signingKey = randomBytes(32);
const deviceKey = 'test-device-public-key';
const clientId = 'test-client-id';
const clientSecret = 'test-client-secret';
const subject = 'tg:208192415';
const liveToken = {
  type: 'tokens', accessToken: 'test-access-token', accessTokenExpiration: 1795500000000,
  userType: 'prod', claims: { sub: subject }, refreshToken: 'test-refresh-token',
  extraField: { preserved: true },
};

process.env.MEZFIT_BROWSER_SESSION_SECRET = signingKey.toString('base64url');
process.env.MEZFIT_AUTH_HOSTS = host + ',mezfit.ru';
process.env.DEXIE_CLOUD_DB_URL = dbUrl;
process.env.DEXIE_CLOUD_CLIENT_ID = clientId;
process.env.DEXIE_CLOUD_CLIENT_SECRET = clientSecret;
delete process.env.TG_OIDC_CLIENT_ID;
delete process.env.TG_OIDC_CLIENT_SECRET;

function cookie(overrides = {}, key = signingKey) {
  const now = Math.floor(Date.now() / 1000);
  const data = {
    version: 2, host, sub: 'opaque-oidc-subject', telegramUserId: 208192415,
    name: 'Verified Name', iat: now - 86401, exp: now + 3600, ...overrides,
  };
  return '__Host-mz_browser_session=' + signed(data, key);
}

function request(options = {}) {
  return handler({
    path, httpMethod: 'POST', body: JSON.stringify({ public_key: deviceKey }),
    headers: { Host: host, Origin: 'https://' + host, Cookie: cookie() },
    ...options,
  });
}

function checkError(response, status, code) {
  assert.equal(response.statusCode, status);
  assert.equal(JSON.parse(response.body).error.code, code);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal(response.multiValueHeaders, undefined);
}

test('v1 and v2 cookies exchange for the same Mini App subject without Telegram or cookie renewal', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, dbUrl + '/token');
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error');
    assert.deepEqual(JSON.parse(init.body), {
      grant_type: 'client_credentials', scopes: ['ACCESS_DB'], public_key: deviceKey,
      client_id: clientId, client_secret: clientSecret,
      claims: { sub: subject, name: 'Verified Name' },
    });
    return Response.json(liveToken);
  });
  const raw = JSON.stringify({
    public_key: deviceKey, userId: 'tg:1', telegramUserId: 2, sub: 'tg:3',
    scopes: ['ADMIN'], roles: ['admin'], realmId: 'fake',
    client_id: 'fake', client_secret: 'fake', claims: { sub: 'tg:4' }, userIdHint: 'tg:5',
  });
  const legacy = cookie({ version: 1, iat: Math.floor(Date.now() / 1000) - 60 });
  for (const session of [legacy, cookie()]) {
    const response = await request({
      headers: { host, origin: 'https://' + host, cookie: session },
      body: Buffer.from(raw).toString('base64'), isBase64Encoded: true,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.deepEqual(JSON.parse(response.body), liveToken);
    assert.equal(response.multiValueHeaders, undefined);
  }
  assert.equal(fetch.mock.callCount(), 2);
});

test('unapproved methods, origin, host and invalid cookies stop before token exchange', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json(liveToken));
  checkError(await request({ httpMethod: 'GET' }), 405, 'METHOD_NOT_ALLOWED');
  for (const origin of [undefined, 'https://mezfit.ru', 'https://other.example']) {
    checkError(await request({ headers: { host, origin, cookie: cookie() } }), 403, 'ORIGIN_MISMATCH');
  }
  checkError(await request({ headers: { host: 'bad.example' } }), 403, 'UNAPPROVED_AUTH_HOST');
  for (const value of [
    undefined, cookie({}, randomBytes(32)), cookie({ exp: 1 }), cookie({ host: 'mezfit.ru' }),
    cookie({ version: 3 }), cookie({ telegramUserId: 0 }), cookie({ telegramUserId: '208192415' }),
    cookie({ telegramUserId: Number.MAX_SAFE_INTEGER + 1 }),
  ]) {
    checkError(await request({ headers: { host, origin: 'https://' + host, cookie: value } }),
      401, 'UNAUTHORIZED');
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('bad JSON, bad keys and missing Dexie settings fail before upstream', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json(liveToken));
  checkError(await request({ body: '{' }), 400, 'INVALID_JSON');
  for (const body of [null, [], {}, { public_key: '' }, { public_key: {} }, { public_key: 'x'.repeat(8193) }]) {
    checkError(await request({ body: JSON.stringify(body) }), 400, 'INVALID_PUBLIC_KEY');
  }
  delete process.env.DEXIE_CLOUD_CLIENT_SECRET;
  try {
    checkError(await request(), 503, 'DEXIE_CLOUD_UNAVAILABLE');
  } finally {
    process.env.DEXIE_CLOUD_CLIENT_SECRET = clientSecret;
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('upstream failures and wrong subjects return safe errors and fixed log fields', async t => {
  const failureBody = 'private-upstream-body';
  const log = t.mock.method(console, 'error', () => {});
  const scenarios = [
    [() => { throw new Error(failureBody); }, 'fetch', null, 'DEXIE_CLOUD_UNAVAILABLE'],
    [() => new Response(failureBody, { status: 403 }), 'http', 403, 'DEXIE_CLOUD_UNAVAILABLE'],
    [() => new Response(failureBody), 'json', 200, 'INVALID_CLOUD_RESPONSE'],
    ...[
      { accessToken: '' }, { accessTokenExpiration: '1' }, { claims: { sub: 'tg:1' } },
      { userType: ['prod'] }, { type: 'other' },
    ].map(overrides => [
      () => Response.json({ ...liveToken, ...overrides }), 'contract', 200, 'INVALID_CLOUD_RESPONSE',
    ]),
  ];
  const fetch = t.mock.method(globalThis, 'fetch');
  for (const [reply, stage, upstreamStatus, code] of scenarios) {
    fetch.mock.mockImplementation(reply);
    const response = await request();
    checkError(response, 502, code);
    for (const privateValue of [failureBody, clientSecret, deviceKey, liveToken.accessToken, subject]) {
      assert.equal(response.body.includes(privateValue), false);
    }
    assert.deepEqual(log.mock.calls.at(-1).arguments,
      ['DEXIE_CLOUD_TOKEN_EXCHANGE_FAILED', { stage, upstreamStatus }]);
  }
});
