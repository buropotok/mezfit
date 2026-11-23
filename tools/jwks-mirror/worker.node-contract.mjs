import assert from 'node:assert/strict';
import test from 'node:test';
import mirror, { normalizeJwks, refresh } from './worker.mjs';

const rsa = (kid, n = 'A'.repeat(342)) => ({ kty: 'RSA', alg: 'RS256', use: 'sig', kid, n, e: 'AQAB' });

test('accepts valid RSA signing keys and normalizes their order', () => {
  const result = normalizeJwks({ keys: [rsa('b'), rsa('a')] });
  assert.deepEqual(result.keys.map(key => key.kid), ['a', 'b']);
  assert.equal(result.keys[0].alg, 'RS256');
});

test('rejects malformed JWKS and duplicate key ids', () => {
  for (const value of [{}, { keys: [] }, { keys: [rsa('same'), rsa('same')] },
    { keys: [{ ...rsa('key'), n: 'tiny' }] },
    { keys: [{ ...rsa('key'), alg: 'HS256' }] },
    { keys: [{ ...rsa('key'), kty: 'oct' }] }]) {
    assert.throws(() => normalizeJwks(value), /JWKS_INVALID/);
  }
});

test('does not provide any public fetching/proxy endpoint', async () => {
  const response = mirror.fetch();
  assert.equal(response.status, 404);
  assert.equal(await response.text(), 'Not Found');
});

test('minute refresh publishes changed JWKS once and always advances heartbeat', async () => {
  const savedFetch = globalThis.fetch;
  const objects = new Map();
  const writes = [];
  const env = {
    YC_JWKS_BUCKET: 'mezfit-telegram-jwks-b1g774t6sgop4rakjob7',
    YC_JWKS_ACCESS_KEY_ID: 'YCAJE12345678',
    YC_JWKS_SECRET_ACCESS_KEY: 'example-local-fixture-only-s3-signing-secret',
  };
  globalThis.fetch = async (url, options = {}) => {
    const address = url.toString();
    if (address === 'https://oauth.telegram.org/.well-known/jwks.json') {
      return new Response(JSON.stringify({ keys: [rsa('telegram-key')] }), { status: 200 });
    }
    const name = address.split('/').at(-1);
    assert.match(options.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=/);
    assert.ok(['jwks.json', 'status.json'].includes(name));
    if (options.method === 'GET') {
      return objects.has(name)
        ? new Response(objects.get(name), { status: 200 })
        : new Response('not-found', { status: 404 });
    }
    assert.equal(options.method, 'PUT');
    writes.push(name);
    objects.set(name, new TextDecoder().decode(options.body));
    return new Response('', { status: 200 });
  };
  try {
    assert.deepEqual(await refresh(env), { changed: true, keyCount: 1 });
    assert.deepEqual(await refresh(env), { changed: false, keyCount: 1 });
    assert.deepEqual(writes, ['jwks.json', 'status.json', 'status.json']);
    assert.deepEqual(JSON.parse(objects.get('status.json')).kids, ['telegram-key']);
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test('invalid Telegram JWKS never publishes objects', async () => {
  const savedFetch = globalThis.fetch;
  let storageCalled = false;
  globalThis.fetch = async url => {
    if (url.toString().includes('storage.yandexcloud.net')) storageCalled = true;
    return new Response(JSON.stringify({ keys: [{ ...rsa('fake'), alg: 'HS256' }] }), { status: 200 });
  };
  try {
    await assert.rejects(refresh({}), /JWKS_INVALID/);
    assert.equal(storageCalled, false);
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test('failed JWKS write does not advertise a successful heartbeat', async () => {
  const savedFetch = globalThis.fetch;
  let statusWritten = false;
  const env = {
    YC_JWKS_BUCKET: 'mezfit-telegram-jwks-b1g774t6sgop4rakjob7',
    YC_JWKS_ACCESS_KEY_ID: 'YCAJE12345678',
    YC_JWKS_SECRET_ACCESS_KEY: 'example-local-fixture-only-s3-signing-secret',
  };
  globalThis.fetch = async (url, options = {}) => {
    if (url.toString().startsWith('https://oauth.telegram.org/')) {
      return new Response(JSON.stringify({ keys: [rsa('fresh')] }), { status: 200 });
    }
    if (options.method === 'GET') return new Response('', { status: 404 });
    if (url.toString().endsWith('/status.json')) statusWritten = true;
    return new Response('denied', { status: 403 });
  };
  try {
    await assert.rejects(refresh(env), /JWKS_WRITE_HTTP_403/);
    assert.equal(statusWritten, false);
  } finally {
    globalThis.fetch = savedFetch;
  }
});
