// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { uploadCloudflareMedia } from './cloudflareMediaUpload';
import { mediaFunctionUrl, rawInitData } from './mediaUploadTestFixtures';

const key = 'mvp-media/' + 'a'.repeat(64);
const host = 'mezfit.' + 'a'.repeat(32) + '.r2.cloudflarestorage.com';
const putUrl = `https://${host}/${key}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost%3Bif-none-match&X-Amz-Signature=${'b'.repeat(64)}`;
const file = () => new File(['sample'], 'sample.jpg', { type: 'image/jpeg' });
const response = () => Response.json({ storageKey: key, putUrl, expiresAt: Date.now() + 600_000 });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('signs via the same-origin Worker and sends bytes directly to R2 with a write-once condition', async () => {
  const transport = vi.fn<typeof fetch>((url) =>
    Promise.resolve(url === '/api/discussion-media/sign' ? response() : new Response(null, { status: 200 })));
  vi.stubGlobal('Telegram', { WebApp: { initData: rawInitData } });
  vi.stubGlobal('fetch', transport);
  const uploaded = await uploadCloudflareMedia(file(), { retryKey: key });
  expect(uploaded).toMatchObject({ key, contentType: 'image/jpeg', sizeBytes: 6 });
  expect(transport.mock.calls[0]).toEqual(['/api/discussion-media/sign',
    expect.objectContaining({ method: 'POST', credentials: 'omit',
      body: JSON.stringify({ initData: rawInitData, storageKey: key, contentType: 'image/jpeg', sizeBytes: 6 }) })]);
  expect(transport.mock.calls[1]).toEqual([putUrl, expect.objectContaining({
    method: 'PUT', headers: { 'Content-Type': 'image/jpeg', 'If-None-Match': '*' },
  })]);
});

it('rejects foreign signed origins and mismatched keys without sending file bytes', async () => {
  const transport = vi.fn<typeof fetch>(async () => Response.json({
    storageKey: key, putUrl: putUrl.replace(host, 'evil.example'), expiresAt: Date.now() + 600_000,
  }));
  vi.stubGlobal('Telegram', { WebApp: { initData: rawInitData } });
  vi.stubGlobal('fetch', transport);
  await expect(uploadCloudflareMedia(file(), { retryKey: key })).rejects.toMatchObject({ code: 'SIGNER_UNAVAILABLE' });
  expect(transport).toHaveBeenCalledOnce();
  transport.mockImplementation(async () => Response.json({
    storageKey: 'mvp-media/' + 'b'.repeat(64), putUrl, expiresAt: Date.now() + 600_000,
  }));
  await expect(uploadCloudflareMedia(file(), { retryKey: key })).rejects.toMatchObject({ code: 'SIGNER_UNAVAILABLE' });
  expect(transport).toHaveBeenCalledTimes(2);
});

it('confirms a retry collision through authenticated Worker HEAD before reporting success', async () => {
  const transport = vi.fn<typeof fetch>((url) => Promise.resolve(
    url === '/api/discussion-media/sign' ? response()
      : url === putUrl ? new Response(null, { status: 412 })
        : Response.json({ present: true }),
  ));
  vi.stubGlobal('Telegram', { WebApp: { initData: rawInitData } });
  vi.stubGlobal('fetch', transport);
  await expect(uploadCloudflareMedia(file(), { retryKey: key })).resolves.toMatchObject({ key });
  expect(transport.mock.calls[2][0]).toBe('/api/discussion-media/verify');
});

it('does not treat a mismatched 412 object as successful', async () => {
  const transport = vi.fn<typeof fetch>((url) => Promise.resolve(
    url === '/api/discussion-media/sign' ? response()
      : url === putUrl ? new Response(null, { status: 412 })
        : new Response(null, { status: 409 }),
  ));
  vi.stubGlobal('Telegram', { WebApp: { initData: rawInitData } });
  vi.stubGlobal('fetch', transport);
  await expect(uploadCloudflareMedia(file(), { retryKey: key })).rejects.toMatchObject({ code: 'HTTP', status: 409 });
});

it('refuses unauthenticated and unsupported uploads before any network request', async () => {
  const transport = vi.fn<typeof fetch>();
  vi.stubGlobal('Telegram', { WebApp: { initData: '' } });
  vi.stubGlobal('fetch', transport);
  await expect(uploadCloudflareMedia(file(), { retryKey: key })).rejects.toMatchObject({ code: 'SIGNER_AUTH' });
  await expect(uploadCloudflareMedia(new File(['x'], 'x.html', { type: 'text/html' }), { retryKey: key }))
    .rejects.toMatchObject({ code: 'INVALID_TYPE' });
  expect(transport).not.toHaveBeenCalled();
});
