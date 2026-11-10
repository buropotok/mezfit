// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadDirectMedia } from './directMediaUpload';
import { mediaFunctionUrl, mockSignedMediaTransport, rawInitData, signedMediaResponse } from './mediaUploadTestFixtures';

const photo = () => new File(['sample'], 'photo.jpg', { type: 'image/jpeg' });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('signed direct media upload', () => {
  it('uploads the original bytes directly and returns a permanent URL without the filename', async () => {
    const put = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    const transport = mockSignedMediaTransport(put);
    const file = photo();
    const result = await uploadDirectMedia(file);
    expect(transport.mock.calls[0]).toEqual([mediaFunctionUrl, expect.objectContaining({
      method: 'POST', credentials: 'omit', redirect: 'error',
      body: JSON.stringify({ initData: rawInitData, storageKey: result.key, contentType: file.type, sizeBytes: file.size }),
    })]);
    expect(result).toMatchObject({ fileName: file.name, sizeBytes: file.size, contentType: file.type });
    expect(result.url).toMatch(/^https:\/\/storage\.yandexcloud\.net\/mezfit-comm-poc-20261106\/mvp-media\/[a-f0-9]{64}$/);
    expect(put).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledWith(expect.stringContaining(result.url + '?X-Amz-Algorithm='), expect.objectContaining({
      method: 'PUT', body: file, credentials: 'omit', redirect: 'error',
      headers: { 'Content-Type': 'image/jpeg', 'If-None-Match': '*' },
    }));
  });

  it('does not request a signature or perform PUT without Telegram initData', async () => {
    const put = vi.fn<typeof fetch>();
    const transport = mockSignedMediaTransport(put);
    vi.stubGlobal('Telegram', undefined);
    await expect(uploadDirectMedia(photo())).rejects.toMatchObject({ code: 'SIGNER_AUTH' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('fails closed if the function is unconfigured or denies upload', async () => {
    const put = vi.fn<typeof fetch>();
    const signer = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ putUrl: 'https://example.com/upload' }));
    mockSignedMediaTransport(put, signer);
    vi.stubEnv('VITE_YANDEX_MEDIA_FUNCTION_URL', '');
    await expect(uploadDirectMedia(photo())).rejects.toMatchObject({ code: 'SIGNER_UNAVAILABLE' });
    expect(signer).not.toHaveBeenCalled();
    vi.stubEnv('VITE_YANDEX_MEDIA_FUNCTION_URL', mediaFunctionUrl);
    await expect(uploadDirectMedia(photo())).rejects.toMatchObject({ code: 'SIGNER_AUTH', status: 401 });
    await expect(uploadDirectMedia(photo())).rejects.toMatchObject({ code: 'SIGNER_UNAVAILABLE', status: 503 });
    await expect(uploadDirectMedia(photo())).rejects.toMatchObject({ code: 'SIGNER_UNAVAILABLE' });
    expect(put).not.toHaveBeenCalled();
  });

  it('rejects a successful response for another object and never PUTs with two expired signatures', async () => {
    const key = 'mvp-media/' + 'a'.repeat(64);
    const put = vi.fn<typeof fetch>();
    const signer = vi.fn<typeof fetch>()
      .mockImplementationOnce(async (_url, init) => {
        const payload = await signedMediaResponse(init).json();
        return Response.json({ ...payload, putUrl: payload.putUrl.replace(key, 'mvp-media/' + 'c'.repeat(64)) });
      })
      .mockImplementation(async (_url, init) => signedMediaResponse(init, { expiresAt: Date.now() - 1 }));
    mockSignedMediaTransport(put, signer);
    await expect(uploadDirectMedia(photo(), { retryKey: key })).rejects.toMatchObject({ code: 'SIGNER_UNAVAILABLE' });
    expect(signer).toHaveBeenCalledOnce();
    await expect(uploadDirectMedia(photo(), { retryKey: key })).rejects.toMatchObject({ code: 'SIGNER_UNAVAILABLE' });
    expect(signer).toHaveBeenCalledTimes(3);
    expect(put).not.toHaveBeenCalled();
  });

  it.each(['before PUT', 'during PUT'])('refreshes a signature that expires %s without changing the key', async when => {
    const file = photo();
    const key = 'mvp-media/' + 'a'.repeat(64);
    const put = vi.fn<typeof fetch>();
    if (when === 'during PUT') {
      put.mockResolvedValueOnce(new Response('<Error><Code>RequestExpired</Code></Error>', { status: 403 }));
    }
    put.mockResolvedValueOnce(new Response(null));
    const signer = vi.fn<typeof fetch>()
      .mockImplementationOnce(async (_url, init) => signedMediaResponse(init, {
        expiresAt: when === 'before PUT' ? Date.now() - 1 : Date.now() + 600_000,
        signature: 'a'.repeat(64),
      }))
      .mockImplementationOnce(async (_url, init) => signedMediaResponse(init));
    mockSignedMediaTransport(put, signer);
    await expect(uploadDirectMedia(file, { retryKey: key })).resolves.toMatchObject({ key });
    expect(signer).toHaveBeenCalledTimes(2);
    expect(signer.mock.calls[0][1]?.body).toBe(signer.mock.calls[1][1]?.body);
    expect(put).toHaveBeenCalledTimes(when === 'before PUT' ? 1 : 2);
    expect(put).toHaveBeenLastCalledWith(expect.stringContaining('X-Amz-Signature=' + 'b'.repeat(64)),
      expect.objectContaining({ method: 'PUT', body: file }));
  });

  it('rejects unsupported, empty and oversized files before networking', async () => {
    const put = vi.fn();
    mockSignedMediaTransport(put);
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
    mockSignedMediaTransport(put);
    const file = photo();
    await expect(uploadDirectMedia(file)).rejects.toMatchObject({ code: 'HTTP', status: 412 });
    await expect(uploadDirectMedia(file)).rejects.toMatchObject({ code: 'NETWORK' });
    await expect(uploadDirectMedia(file)).resolves.toMatchObject({ fileName: file.name });
    expect(new Set(put.mock.calls.map(([url]) => url)).size).toBe(3);
  });

  it('reports an S3 XML error code and message for a rejected upload', async () => {
    mockSignedMediaTransport(vi.fn<typeof fetch>().mockResolvedValue(new Response(
      '<Error><Code>AccessDenied</Code><Message>Access Denied.</Message></Error>',
      { status: 403, headers: { 'Content-Type': 'application/xml' } },
    )));
    await expect(uploadDirectMedia(photo())).rejects.toMatchObject({
      code: 'HTTP', status: 403, s3Code: 'AccessDenied', s3Message: 'Access Denied.',
    });
  });

  it('recognizes other S3 error codes but never displays object paths in messages', async () => {
    const put = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(
        '<Error><Code>OperationAborted</Code><Message>Operation aborted.</Message></Error>',
        { status: 409 },
      ))
      .mockResolvedValueOnce(new Response(
        '<Error><Code>AccessDenied</Code><Message>Denied for https://example.com/private/key</Message></Error>',
        { status: 403 },
      ))
      .mockResolvedValueOnce(new Response(
        `<Error><Code>NoSuchKey</Code><Message>Object ${'a'.repeat(64)} not found</Message></Error>`,
        { status: 404 },
      ));
    mockSignedMediaTransport(put);
    await expect(uploadDirectMedia(photo())).rejects.toMatchObject({
      code: 'HTTP', status: 409, s3Code: 'OperationAborted', s3Message: 'Operation aborted.',
    });
    await expect(uploadDirectMedia(photo())).rejects.toMatchObject({
      code: 'HTTP', status: 403, s3Code: 'AccessDenied', s3Message: undefined,
    });
    await expect(uploadDirectMedia(photo())).rejects.toMatchObject({
      code: 'HTTP', status: 404, s3Code: 'NoSuchKey', s3Message: undefined,
    });
  });

  it('preserves HTTP status when the error response is malformed or cannot be read', async () => {
    const unreadable = new Response(null, { status: 503 });
    vi.spyOn(unreadable, 'text').mockRejectedValue(new Error('body read failed'));
    const put = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('<html>Unauthorized</html>', { status: 403 }))
      .mockResolvedValueOnce(unreadable);
    mockSignedMediaTransport(put);
    await expect(uploadDirectMedia(photo())).rejects.toMatchObject({
      code: 'HTTP', status: 403, s3Code: undefined, s3Message: undefined,
    });
    await expect(uploadDirectMedia(photo())).rejects.toMatchObject({
      code: 'HTTP', status: 503, s3Code: undefined, s3Message: undefined,
    });
  });

  it('aborts an active PUT on cancellation and distinguishes timeout', async () => {
    vi.useFakeTimers();
    const put = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    mockSignedMediaTransport(put);
    const controller = new AbortController();
    const cancelled = expect(uploadDirectMedia(photo(), { signal: controller.signal })).rejects.toMatchObject({ code: 'CANCELLED' });
    await vi.advanceTimersByTimeAsync(0);
    expect(put).toHaveBeenCalledOnce();
    controller.abort();
    await cancelled;
    const timedOut = expect(uploadDirectMedia(photo(), { timeoutMs: 20 })).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(20);
    await timedOut;
    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls.every(([, init]) => init?.signal?.aborted)).toBe(true);
  });
});
