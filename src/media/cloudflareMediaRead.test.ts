// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { signedDiscussionR2ReadUrl } from './cloudflareMediaRead';
import { rawInitData } from './mediaUploadTestFixtures';

const key = 'mvp-media/' + 'a'.repeat(64);
const host = 'mezfit-discussion-media.' + 'a'.repeat(32) + '.r2.cloudflarestorage.com';
const getUrl = `https://${host}/${key}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-SignedHeaders=host&X-Amz-Signature=${'b'.repeat(64)}`;
const entry = { accountId: 'tg:100500', storageKey: key, mimeType: 'video/mp4', sizeBytes: 100,
  realmId: 'rlm' + 'b'.repeat(28), messageId: '22222222-2222-4222-8222-222222222222', attachmentId: '33333333-3333-4333-8333-333333333333' };
const response = () => Response.json({ storageKey: key, getUrl, expiresAt: Date.now() + 600_000 });

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('gets a private signed GET URL only through the typed same-origin Worker API', async () => {
  vi.stubGlobal('Telegram', { WebApp: { initData: rawInitData } });
  const transport = vi.fn<typeof fetch>(async () => response());
  vi.stubGlobal('fetch', transport);
  expect(await signedDiscussionR2ReadUrl(entry)).toBe(getUrl);
  expect(transport).toHaveBeenCalledWith('/api/discussion-media/read',
    expect.objectContaining({ method: 'POST', credentials: 'omit',
      body: JSON.stringify({ initData: rawInitData, storageKey: key,
        contentType: 'video/mp4', sizeBytes: 100,
        realmId: entry.realmId, messageId: entry.messageId, attachmentId: entry.attachmentId }) }));
});

it('rejects unsigned/foreign/mismatched/expired capabilities instead of fetching arbitrary URLs', async () => {
  vi.stubGlobal('Telegram', { WebApp: { initData: rawInitData } });
  const transport = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ storageKey: key, getUrl: getUrl.replace(host, 'evil.example'),
      expiresAt: Date.now() + 600_000 }))
    .mockResolvedValueOnce(Response.json({ storageKey: key, getUrl: getUrl.replace('X-Amz-SignedHeaders=host', 'X-Amz-SignedHeaders=none'),
      expiresAt: Date.now() + 600_000 }))
    .mockResolvedValueOnce(Response.json({ storageKey: 'mvp-media/' + 'c'.repeat(64), getUrl,
      expiresAt: Date.now() + 600_000 }))
    .mockResolvedValueOnce(Response.json({ storageKey: key, getUrl, expiresAt: Date.now() - 100 }));
  vi.stubGlobal('fetch', transport);
  for (let i = 0; i < 4; i++) await expect(signedDiscussionR2ReadUrl(entry)).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(4);
});

it('denies an anonymous or missing-identity media read before network access', async () => {
  const transport = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', transport);
  vi.stubGlobal('Telegram', { WebApp: { initData: '' } });
  await expect(signedDiscussionR2ReadUrl(entry)).rejects.toThrow('R2_READ_AUTH_REQUIRED');
  await expect(signedDiscussionR2ReadUrl({ ...entry, messageId: undefined })).rejects.toThrow('R2_READ_INVALID_MEDIA');
  expect(transport).not.toHaveBeenCalled();
});
