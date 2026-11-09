// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeHosting, probeRequest } from './networkProbe';

const signal = () => new AbortController().signal;
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('network diagnostics', () => {
  it('does not turn an untrusted response body/error URL into a diagnostic result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('secret-signed-url')));
    const result = await probeRequest('storage-get', 'https://private', {}, signal(), async () => true);
    expect(result.code).toBe('NETWORK_OR_CORS');
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('distinguishes HTTP errors from network/CORS failures and never reads the error body', async () => {
    const response = new Response('private-error-body', { status: 403 });
    const verify = vi.fn(async () => true);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    const result = await probeRequest('storage-get', 'https://private', {}, signal(), verify);
    expect(result).toMatchObject({ code: 'HTTP_ERROR', status: 403 });
    expect(verify).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('private-error');
  });
  it('does no work for an already cancelled experiment', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController(); controller.abort();
    expect((await probeRequest('hosting', '/x', {}, controller.signal, async () => true)).code).toBe('CANCELLED');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('fetches fresh hosting assets without forwarding launch payload/query/hash', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('<script src="https://telegram.org/js/telegram-web-app.js"></script><script type="module" src="/assets/index-abc.js"></script>', { headers: { 'content-type': 'text/html' } }))
      .mockResolvedValueOnce(new Response('export{}', { headers: { 'content-type': 'application/javascript' } }));
    vi.stubGlobal('fetch', fetchMock);
    const results = await probeHosting('https://app.example', signal());
    expect(results.every(result => result.code === 'OK')).toBe(true);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(String(url)).toContain('comm02=');
      expect(init).toMatchObject({ cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    }
  });
});
