import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeJwks, refresh } from './worker.mjs';

const rsa = { kty: 'RSA', alg: 'RS256', kid: 'oidc-1', n: 'A'.repeat(342), e: 'AQAB' };
// Match the key types advertised by Telegram. The key material is synthetic.
const otherKeys = [
  { kty: 'EC', alg: 'ES256', kid: 'oidc-es256-1' },
  { kty: 'OKP', alg: 'EdDSA', kid: 'oidc-eddsa-1' },
  { kty: 'EC', alg: 'ES256K', kid: 'oidc-es256k-1' },
];

test('mirrors only RS256 keys from the mixed Telegram JWKS', async () => {
  const originalFetch = globalThis.fetch;
  const objects = new Map();
  const env = {
    YC_JWKS_BUCKET: 'mezfit-telegram-jwks-fixture',
    YC_JWKS_ACCESS_KEY_ID: 'fixture-access-key',
    YC_JWKS_SECRET_ACCESS_KEY: 'fixture-secret',
  };
  globalThis.fetch = async (url, options) => {
    if (url.toString() === 'https://oauth.telegram.org/.well-known/jwks.json') {
      return Response.json({ keys: [rsa, ...otherKeys] });
    }
    assert.equal(url.origin, 'https://storage.yandexcloud.net');
    const name = url.pathname.split('/').at(-1);
    if (options.method === 'GET') return new Response(null, { status: 404 });
    assert.equal(options.method, 'PUT');
    objects.set(name, JSON.parse(new TextDecoder().decode(options.body)));
    return new Response(null, { status: 200 });
  };
  try {
    assert.deepEqual(await refresh(env), { changed: true, keyCount: 1 });
    assert.deepEqual(objects.get('jwks.json'), { keys: [{ ...rsa, use: 'sig' }] });
    assert.deepEqual(objects.get('status.json').kids, ['oidc-1']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects an upstream set without RS256 keys or with invalid RS256 entries', () => {
  for (const keys of [
    otherKeys,
    [rsa, ...otherKeys, { ...rsa, kid: 'malformed', n: 'short' }],
    [rsa, ...otherKeys, rsa],
    [rsa, { ...otherKeys[0], alg: 'RS256' }],
  ]) {
    assert.throws(() => normalizeJwks({ keys }, { allowOtherAlgorithms: true }), /JWKS_INVALID/);
  }
});

test('requires a stored baseline to contain only validated RS256 keys', () => {
  assert.throws(() => normalizeJwks({ keys: [rsa, ...otherKeys] }), /JWKS_INVALID/);
});
