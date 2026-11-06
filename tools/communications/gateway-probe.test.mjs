import { afterEach, describe, expect, it, vi } from 'vitest';
import { handler, probeDexie } from './gateway-probe.mjs';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('gateway network experiment', () => {
  it('uses fixed read-only Dexie routes, scopes bearer only to authenticated read and exports no bodies', async () => {
    const transport = vi.fn(async () => new Response('[{"private":"record"}]', { headers: { 'content-type': 'application/json' } }));
    const result = await probeDexie(transport, 'ordinary-test-token');
    expect(result.results.every(row => row.code === 'OK')).toBe(true);
    expect(transport.mock.calls[0][1].headers).toEqual({});
    expect(transport.mock.calls[1][1].headers).toEqual({ Authorization: 'Bearer ordinary-test-token' });
    expect(transport.mock.calls.every(([url, init]) => new URL(url).hostname === 'zjv60oxag.dexie.cloud' && init.method === 'GET')).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/record|ordinary-test-token/);
    expect(result.authorizationDesignProven).toBe(false);
  });
  it('does not claim authenticated reachability when the ordinary test token is missing', async () => {
    const transport = vi.fn(async () => new Response('[]', { headers: { 'content-type': 'application/json' } }));
    expect((await probeDexie(transport)).results[1].code).toBe('NOT_CONFIGURED');
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('does not forward caller URLs and denies unauthorized or malformed methods before network access', async () => {
    const transport = vi.fn(); vi.stubGlobal('fetch', transport);
    vi.stubEnv('COMM02_PROBE_SECRET', 'x'.repeat(32));
    expect((await handler({ httpMethod: 'POST', headers: {}, body: 'https://attacker.example' })).statusCode).toBe(401);
    expect((await handler({ httpMethod: 'GET', headers: { authorization: `Bearer ${'x'.repeat(32)}` } })).statusCode).toBe(405);
    expect(transport).not.toHaveBeenCalled();
  });
  it('reports an upstream authorization failure separately from a network error without raw errors', async () => {
    const transport = vi.fn().mockResolvedValueOnce(new Response('private', { status: 403 }))
      .mockRejectedValueOnce(new Error('secret-token'));
    const result = await probeDexie(transport, 'ordinary-test-token');
    expect(result.results.map(row => row.code)).toEqual(['HTTP_ERROR', 'NETWORK_ERROR']);
    expect(JSON.stringify(result)).not.toMatch(/private|secret-token/);
  });
});
