import assert from 'node:assert/strict';
import test from 'node:test';
import mirror, { normalizeJwks } from './worker.mjs';

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
