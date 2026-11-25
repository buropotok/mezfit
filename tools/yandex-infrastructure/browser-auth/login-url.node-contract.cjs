'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, createHmac, randomBytes } = require('node:crypto');
const { handler, _test: { signed, verified } } = require('./index.js');

const host = 'mezfit.online';
const path = '/auth/telegram-login';
const storage = 'https://storage.yandexcloud.net/mezfit-browser-nonce-test1234/used/';
const key = randomBytes(32);
const botKey = createHash('sha256').update('123456:test-bot-token').digest();
const context = { token: { access_token: 'storage-iam' } };
const time = () => Math.floor(Date.now() / 1000);
process.env.MEZFIT_BROWSER_SESSION_SECRET = key.toString('base64url');
process.env.MEZFIT_AUTH_HOSTS = host + ',mezfit.ru';
process.env.MEZFIT_BROWSER_CHALLENGE_BUCKET = 'mezfit-browser-nonce-test1234';
process.env.MEZFIT_TELEGRAM_LOGIN_URL_KEY = botKey.toString('hex');

function fixture(overrides = {}, signingKey = botKey) {
  const id = { auth_date: String(time()), first_name: 'Алёна <Тест>', id: '12345', username: 'example', ...overrides };
  const input = Object.keys(id).sort().map(name => name + '=' + id[name]).join('\n');
  return { ...id, hash: createHmac('sha256', signingKey).update(input).digest('hex') };
}

function request(method = 'GET', options = {}) {
  return handler({ path, httpMethod: method, headers: { host }, ...options }, context);
}

function query(values) {
  return { queryStringParameters: values,
    multiValueQueryStringParameters: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, [v]])) };
}

function cookies(response) {
  return response.multiValueHeaders?.['Set-Cookie'] ?? [];
}
const pair = value => value.split(';')[0];

async function begin(values = fixture()) {
  const response = await request('GET', query(values));
  assert.equal(response.statusCode, 302);
  assert.equal(response.headers.Location, path);
  const [pending] = cookies(response);
  assert.match(pending, /Secure; HttpOnly; SameSite=Lax; Max-Age=/);
  assert.doesNotMatch(pending, /mz_browser_session/);
  const page = await request('GET', { headers: { host, cookie: pair(pending) } });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /Алёна &lt;Тест&gt;/);
  assert.ok(!page.body.includes(values.hash));
  assert.match(page.headers['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.equal(page.headers['Cache-Control'], 'no-store');
  assert.equal(page.headers['Referrer-Policy'], 'no-referrer');
  return { cookie: pair(pending), nonce: /name="nonce" value="([^"]+)"/.exec(page.body)[1] };
}

function confirm(flow, { origin = 'https://' + host, action = 'confirm', nonce = flow.nonce,
  cookie = flow.cookie } = {}) {
  return request('POST', {
    headers: { host, origin, cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ nonce, action }).toString(),
  });
}

function sessionCookie(id) {
  return '__Host-mz_browser_session=' + signed({
    version: 2, host, sub: 'oidc-subject', telegramUserId: id, iat: time(), exp: time() + 3600,
  }, key);
}

test('signed GET clears URL and explicit POST creates the existing session without Telegram OIDC configuration', async t => {
  delete process.env.TG_OIDC_CLIENT_ID;
  delete process.env.TG_OIDC_CLIENT_SECRET;
  const fetch = t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.ok(url.startsWith(storage));
    assert.equal(init.method, 'PUT');
    assert.equal(init.headers['If-None-Match'], '*');
    return new Response(null, { status: 200 });
  });
  const flow = await begin();
  assert.equal(fetch.mock.callCount(), 0);
  const result = await confirm(flow);
  assert.equal(result.statusCode, 303);
  assert.equal(result.headers.Location, '/');
  const [clear, session] = cookies(result);
  assert.match(clear, /Max-Age=0/);
  assert.match(session, /^__Host-mz_browser_session=/);
  const data = verified(pair(session).split('=')[1], key);
  assert.equal(data.version, 2);
  assert.equal(data.sub, 'telegram-login-url:12345');
  assert.equal(data.telegramUserId, 12345);

  process.env.TG_OIDC_CLIENT_ID = '123456';
  process.env.TG_OIDC_CLIENT_SECRET = 'fixture-secret';
  const headers = { host, origin: 'https://' + host, cookie: pair(session) };
  const state = await request('GET', { path: '/auth/session', headers });
  assert.equal(JSON.parse(state.body).telegramUserId, '12345');
  process.env.DEXIE_CLOUD_DB_URL = 'https://test.dexie.cloud';
  process.env.DEXIE_CLOUD_CLIENT_ID = 'fixture-id';
  process.env.DEXIE_CLOUD_CLIENT_SECRET = 'fixture-secret';
  fetch.mock.mockImplementation(async (url, init) => {
    assert.equal(url, 'https://test.dexie.cloud/token');
    assert.equal(JSON.parse(init.body).claims.sub, 'tg:12345');
    return Response.json({
      type: 'tokens', accessToken: 'fixture-access', accessTokenExpiration: Date.now() + 60000,
      userType: 'prod', claims: { sub: 'tg:12345' },
    });
  });
  assert.equal((await request('POST', { path: '/api/dexie-cloud/tokens', headers,
    body: JSON.stringify({ public_key: 'fixture-public-key' }) })).statusCode, 200);
  const logout = await request('POST', { path: '/auth/logout', headers });
  assert.ok(cookies(logout).some(value => value.startsWith('__Host-mz_oidc_popup=;')));
  assert.ok(cookies(logout).some(value => value.startsWith('__Host-mz_browser_session=;')));
});

test('rejects invalid signed data, ambiguous query maps and unexpected origin without creating a session', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw Error(); });
  const correct = fixture();
  const missing = { ...correct };
  delete missing.first_name;
  for (const values of [
    { ...correct, id: '999' }, { ...correct, first_name: 'Changed' }, missing,
    fixture({ id: '01' }), fixture({ id: '9007199254740992' }),
    fixture({ auth_date: String(time() - 121) }), fixture({ auth_date: String(time() + 31) }),
    fixture({ next: 'https://other.example' }), fixture({ first_name: 'Line\nid=2' }),
    fixture({}, createHmac('sha256', 'WebAppData').update('123456:test-bot-token').digest()),
    { ...correct, hash: '00' }, { ...correct, hash: 'zz'.repeat(32) },
  ]) {
    const delivery = await request('GET', query(values));
    const error = await request('GET', { headers: { host, cookie: pair(cookies(delivery)[0]) } });
    assert.equal(error.statusCode, 400);
    assert.ok(!error.body.includes(correct.hash));
    assert.doesNotMatch(cookies(delivery).join(), /mz_browser_session/);
  }
  for (const maps of [
    { queryStringParameters: correct },
    { ...query(correct), multiValueQueryStringParameters: { ...query(correct).multiValueQueryStringParameters, id: ['12345', '12345'] } },
    { ...query(correct), multiValueQueryStringParameters: { ...query(correct).multiValueQueryStringParameters, id: ['777'] } },
  ]) assert.equal((await request('GET', maps)).headers.Location, path);
  assert.equal((await request('GET', { headers: { host: 'mezfit.ru' }, ...query(correct) })).statusCode, 403);
  assert.equal((await request('DELETE')).statusCode, 405);
  assert.equal((await request()).headers.Location, '/');
  const flow = await begin(correct);
  assert.equal((await confirm(flow, { nonce: 'wrong' })).statusCode, 400);
  assert.equal((await confirm(flow, { cookie: flow.cookie + 'x' })).statusCode, 400);
  assert.equal((await confirm(flow, { origin: 'https://mezfit.ru' })).statusCode, 403);
  assert.equal((await confirm(flow, { action: 'cancel' })).statusCode, 303);
  assert.equal(fetch.mock.callCount(), 0);
});

test('same-account session is preserved and conflicting sessions cannot be overwritten', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw Error(); });
  const existing = await request('GET', {
    headers: { host, cookie: sessionCookie(12345) }, ...query(fixture()),
  });
  assert.equal(existing.headers.Location, '/');
  assert.deepEqual(cookies(existing), []);
  const flow = await begin();
  const changed = await confirm(flow, { cookie: flow.cookie + '; ' + sessionCookie(77777) });
  assert.equal(changed.statusCode, 409);
  assert.match(changed.body, /другой аккаунт/);
  assert.doesNotMatch(cookies(changed).join(), /mz_browser_session/);
  assert.equal(fetch.mock.callCount(), 0);
});

test('concurrent visits share one marker and storage failures never create a session', async t => {
  const used = new Set();
  const fetch = t.mock.method(globalThis, 'fetch', async url => {
    if (used.has(url)) return new Response(null, { status: 412 });
    used.add(url);
    return new Response(null, { status: 200 });
  });
  const payload = fixture();
  const [first, second] = await Promise.all([begin(payload), begin(payload)]);
  assert.notEqual(first.nonce, second.nonce);
  const results = await Promise.all([confirm(first), confirm(second)]);
  assert.deepEqual(results.map(response => response.statusCode).sort(), [303, 409]);
  assert.equal(used.size, 1);
  assert.equal(results.flatMap(cookies).filter(value => value.startsWith('__Host-mz_browser_session')).length, 1);
  fetch.mock.mockImplementation(async () => new Response(null, { status: 403 }));
  const unavailable = await confirm(await begin());
  assert.equal(unavailable.statusCode, 503);
  assert.doesNotMatch(cookies(unavailable).join(), /mz_browser_session/);
});

test('rechecks payload expiry after storage acknowledgement', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const flow = await begin();
  t.mock.method(globalThis, 'fetch', async () => {
    now += 121_000;
    return new Response(null, { status: 200 });
  });
  const response = await confirm(flow);
  assert.equal(response.statusCode, 400);
  assert.equal(response.headers['X-Mezfit-Login-Code'], 'INVALID_OR_EXPIRED');
  assert.doesNotMatch(cookies(response).join(), /mz_browser_session/);
});
