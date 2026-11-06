// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseStorageTicket, probeHosting, probeRequest, probeStorageReads, uploadProbe, TEST_BUCKET } from './networkProbe';

const ticket = () => Object.fromEntries(['put', 'get', 'head'].map(method => [method,
  `https://storage.yandexcloud.net/${TEST_BUCKET}/comm02/test.bin?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-SignedHeaders=host&X-Amz-Expires=900&X-Amz-Signature=${'a'.repeat(64)}`]));
const signal = () => new AbortController().signal;
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('private storage capability boundary', () => {
  it('accepts scoped Yandex signatures while rejecting foreign hosts, object substitutions and key files', () => {
    expect(parseStorageTicket(ticket()).put).toContain(TEST_BUCKET);
    for (const invalid of [
      { ...ticket(), put: 'https://attacker.example/file' },
      { ...ticket(), get: String(ticket().get).replace('/test.bin', '/other.bin') },
      { ...ticket(), head: String(ticket().head).replace('Expires=900', 'Expires=3600') },
      { ...ticket(), secretAccessKey: 'do-not-log' },
    ]) expect(() => parseStorageTicket(invalid)).toThrow();
  });
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
  it('requires an actual 206 Content-Range and matching bytes rather than accepting a 200 SPA/error fallback', async () => {
    const file = new Blob([new Uint8Array([37, 37, 37])]);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { headers: { 'content-length': '3' } }))
      .mockResolvedValueOnce(new Response('%%%'))
      .mockResolvedValueOnce(new Response('%%%', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const results = await probeStorageReads(parseStorageTicket(ticket()), file, signal());
    expect(results.map(result => result.code)).toEqual(['OK', 'OK', 'INVALID_RESPONSE']);
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ headers: { Range: 'bytes=0-2' }, credentials: 'omit', redirect: 'error' });
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


describe('range integrity and upload lifecycle', () => {
  it('accepts correct private partial content and rejects different bytes with the same advertised range', async () => {
    const file = await new Response(new Uint8Array([37, 37, 37])).blob();
    for (const [body, expected] of [['%%%', 'OK'], ['%x%', 'INVALID_RESPONSE']]) {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(new Response(null, { headers: { 'content-length': '3' } }))
        .mockResolvedValueOnce(new Response('%%%'))
        .mockResolvedValueOnce(new Response(body, { status: 206, headers: { 'content-range': 'bytes 0-2/3' } })));
      expect((await probeStorageReads(parseStorageTicket(ticket()), file, signal()))[2].code).toBe(expected);
    }
  });
  it('records observations while hidden without interpreting progress as completion, and aborts/cleans up', async () => {
    class FakeXHR {
      upload: { onprogress: ((event: { loaded: number }) => void) | null } = { onprogress: null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      ontimeout: (() => void) | null = null;
      open = vi.fn(); send = vi.fn(); setRequestHeader = vi.fn();
      abort = vi.fn(() => this.onabort?.());
      constructor() { created.push(this); }
    }
    const created: FakeXHR[] = [];
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const remove = vi.spyOn(document, 'removeEventListener');
    const controller = new AbortController();
    const observe = vi.fn();
    const pending = uploadProbe(parseStorageTicket(ticket()), new Blob(['data']), controller.signal, observe);
    created[0].upload.onprogress?.({ loaded: 2 });
    expect(observe).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'progress', hidden: true, loaded: 2 }));
    controller.abort();
    expect((await pending).code).toBe('CANCELLED');
    expect(created[0].abort).toHaveBeenCalledOnce();
    expect(created[0].upload.onprogress).toBeNull();
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(observe.mock.calls.every(([event]) => event.kind !== 'complete')).toBe(true);
  });
});
