import assert from 'node:assert/strict';
import test from 'node:test';
import { refresh } from './worker.mjs';

const SOURCE = 'https://oauth.telegram.org/.well-known/jwks.json';
const BUCKET = 'https://storage.yandexcloud.net/mezfit-telegram-jwks-b1g774t6sgop4rakjob7/';
const env = {
  YC_JWKS_BUCKET: 'mezfit-telegram-jwks-b1g774t6sgop4rakjob7',
  YC_JWKS_ACCESS_KEY_ID: 'YCAJEK0Iv6xqy-pEQcueLTAdg',
  YC_JWKS_SECRET_ACCESS_KEY: 'only-a-test-fixture-not-a-real-s3-secret',
};
const jwks = { keys: [{
  kty: 'RSA', alg: 'RS256', use: 'sig', kid: 'telegram-test',
  n: 'A'.repeat(342), e: 'AQAB',
}] };

test('Cloudflare-compatible manual redirect rejects Telegram redirect before touching storage', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls += 1;
    assert.equal(url.toString(), SOURCE);
    assert.equal(options.redirect, 'manual');
    return new Response(null, {
      status: 302, headers: { location: 'https://untrusted.invalid/jwks.json' },
    });
  };
  try {
    await assert.rejects(refresh(env), /FETCH_HTTP_302/);
    assert.equal(calls, 1, 'an upstream redirect must not trigger another request');
  } finally {
    globalThis.fetch = original;
  }
});

test('a redirect from signed Yandex S3 GET is rejected without following it', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const address = url.toString();
    calls.push(address);
    assert.equal(options.redirect, 'manual');
    if (address === SOURCE) {
      return new Response(JSON.stringify(jwks), { status: 200 });
    }
    assert.equal(address, BUCKET + 'jwks.json');
    assert.equal(options.method, 'GET');
    assert.match(options.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=/);
    return new Response(null, {
      status: 307, headers: { location: 'https://untrusted.invalid/collect' },
    });
  };
  try {
    await assert.rejects(refresh(env), /FETCH_HTTP_307/);
    assert.deepEqual(calls, [SOURCE, BUCKET + 'jwks.json']);
  } finally {
    globalThis.fetch = original;
  }
});

test('a redirect from Yandex S3 PUT cannot advance the success heartbeat', async () => {
  const original = globalThis.fetch;
  const writes = [];
  globalThis.fetch = async (url, options) => {
    const address = url.toString();
    assert.equal(options.redirect, 'manual');
    if (address === SOURCE) {
      return new Response(JSON.stringify(jwks), { status: 200 });
    }
    assert.ok(address.startsWith(BUCKET));
    if (options.method === 'GET') return new Response(null, { status: 404 });
    writes.push(address);
    return new Response(null, {
      status: 307, headers: { location: 'https://untrusted.invalid/collect' },
    });
  };
  try {
    await assert.rejects(refresh(env), /JWKS_WRITE_HTTP_307/);
    assert.deepEqual(writes, [BUCKET + 'jwks.json']);
  } finally {
    globalThis.fetch = original;
  }
});
