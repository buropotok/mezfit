// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadDirectMedia } from './directMediaUpload';

const photo = () => new File(['sample'], 'photo.jpg', { type: 'image/jpeg' });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('anonymous direct media upload', () => {
  it('uploads the original bytes directly and returns a permanent URL without the filename', async () => {
    const put = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', put);
    const file = photo();
    const result = await uploadDirectMedia(file);
    expect(result).toMatchObject({ fileName: file.name, sizeBytes: file.size, contentType: file.type });
    expect(result.url).toMatch(/^https:\/\/storage\.yandexcloud\.net\/mezfit-comm-poc-20261106\/mvp-media\/[a-f0-9]{64}$/);
    expect(put).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledWith(result.url, expect.objectContaining({
      method: 'PUT', body: file, credentials: 'omit', redirect: 'error',
      headers: { 'Content-Type': 'image/jpeg', 'If-None-Match': '*' },
    }));
  });

  it('rejects unsupported, empty and oversized files before networking', async () => {
    const put = vi.fn();
    vi.stubGlobal('fetch', put);
    const oversized = photo();
    Object.defineProperty(oversized, 'size', { value: 20 * 1024 * 1024 + 1 });
    await expect(uploadDirectMedia(new File(['x'], 'x.html', { type: 'text/html' }))).rejects.toMatchObject({ code: 'INVALID_TYPE' });
    await expect(uploadDirectMedia(new File([], 'empty.jpg', { type: 'image/jpeg' }))).rejects.toMatchObject({ code: 'INVALID_SIZE' });
    await expect(uploadDirectMedia(oversized)).rejects.toMatchObject({ code: 'INVALID_SIZE' });
    expect(put).not.toHaveBeenCalled();
  });

  it('surfaces HTTP and network failures and uses a fresh key on retry', async () => {
    const put = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 412 }))
      .mockRejectedValueOnce(new TypeError('failed')).mockResolvedValueOnce(new Response(null));
    vi.stubGlobal('fetch', put);
    const file = photo();
    await expect(uploadDirectMedia(file)).rejects.toMatchObject({ code: 'HTTP', status: 412 });
    await expect(uploadDirectMedia(file)).rejects.toMatchObject({ code: 'NETWORK' });
    await expect(uploadDirectMedia(file)).resolves.toMatchObject({ fileName: file.name });
    expect(new Set(put.mock.calls.map(([url]) => url)).size).toBe(3);
  });

  it('aborts an active PUT on cancellation and distinguishes timeout', async () => {
    vi.useFakeTimers();
    const put = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    vi.stubGlobal('fetch', put);
    const controller = new AbortController();
    const cancelled = expect(uploadDirectMedia(photo(), { signal: controller.signal })).rejects.toMatchObject({ code: 'CANCELLED' });
    controller.abort();
    await cancelled;
    const timedOut = expect(uploadDirectMedia(photo(), { timeoutMs: 20 })).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(20);
    await timedOut;
    expect(put.mock.calls.every(([, init]) => init?.signal?.aborted)).toBe(true);
  });
});
