import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, expect, it, vi } from 'vitest';
import { downloadDiscussionMedia, readDiscussionMedia, storeDiscussionMedia } from './discussionMediaCache';
import { rawInitData } from './mediaUploadTestFixtures';

const file = new Blob(['video'], { type: 'video/mp4' });
const entry = {
  accountId: 'tg:8101', storageKey: 'mvp-media/' + 'a'.repeat(64), mimeType: file.type, sizeBytes: file.size,
};
const other = { ...entry, accountId: 'tg:8102' };

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all([entry, other].map(({ accountId }) => Dexie.delete(`mezfit-discussion-media:${accountId}`)));
});

it('keeps gallery bytes available in IndexedDB only for the current account', async () => {
  await storeDiscussionMedia(entry, file);
  expect(await (await readDiscussionMedia(entry))?.text()).toBe('video');
  expect(await readDiscussionMedia(other)).toBeNull();
  expect(await readDiscussionMedia({ ...entry, sizeBytes: file.size + 1 })).toBeNull();
});

it('shares an in-flight download and only keeps a complete response', async () => {
  const fetchMedia = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(file, { status: 206 }))
    .mockResolvedValueOnce(new Response(file, { status: 200 }));
  vi.stubGlobal('fetch', fetchMedia);

  expect(await downloadDiscussionMedia(entry)).toBeNull();
  expect(await readDiscussionMedia(entry)).toBeNull();
  const first = downloadDiscussionMedia(entry);
  expect(downloadDiscussionMedia(entry)).toBe(first);
  expect(await (await first)?.text()).toBe('video');
  expect(await (await readDiscussionMedia(entry))?.text()).toBe('video');
  expect(fetchMedia).toHaveBeenCalledTimes(2);
});

it('completes a full photo when the body takes over eight seconds but keeps making progress', async () => {
  const photo = { ...entry, storageKey: `mvp-media/${'a'.repeat(64)}/full/${'b'.repeat(64)}`,
    mimeType: 'image/jpeg', sizeBytes: 3 };
  vi.useFakeTimers();
  try {
    const fetchMedia = vi.fn<typeof fetch>(async (_url, options) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const timers = [7_000, 14_000, 21_000].map((delay, index) => setTimeout(() => {
            controller.enqueue(Uint8Array.of(index + 1));
            if (index === 2) controller.close();
          }, delay));
          options?.signal?.addEventListener('abort', () => {
            timers.forEach(timer => clearTimeout(timer));
            controller.error(new Error('aborted'));
          }, { once: true });
        },
      });
      return new Response(body, { headers: { 'Content-Type': photo.mimeType } });
    });
    vi.stubGlobal('fetch', fetchMedia);

    const download = downloadDiscussionMedia(photo);
    await vi.advanceTimersByTimeAsync(21_000);
    const blob = await download;
    expect(blob?.size).toBe(3);
    expect(fetchMedia.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    expect(fetchMedia).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
  expect(await readDiscussionMedia(photo)).toBeNull();
});

it('stops a full photo when its response body stalls', async () => {
  const photo = { ...entry, storageKey: `mvp-media/${'a'.repeat(64)}/full/${'c'.repeat(64)}`,
    mimeType: 'image/jpeg', sizeBytes: 2 };
  vi.useFakeTimers();
  try {
    const fetchMedia = vi.fn<typeof fetch>(async (_url, options) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Uint8Array.of(1));
          options?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true });
        },
      });
      return new Response(body, { headers: { 'Content-Type': photo.mimeType } });
    });
    vi.stubGlobal('fetch', fetchMedia);

    const download = downloadDiscussionMedia(photo);
    await vi.advanceTimersByTimeAsync(15_001);
    expect(await download).toBeNull();
    expect(fetchMedia.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

it('requests an authorized R2 read when Yandex fails with backup disabled', async () => {
  vi.stubGlobal('localStorage', { getItem: () => 'off' });
  vi.stubGlobal('window', { Telegram: { WebApp: { initData: rawInitData } } });
  const fetchMedia = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockResolvedValueOnce(new Response(null, { status: 403 }));
  vi.stubGlobal('fetch', fetchMedia);

  await expect(downloadDiscussionMedia({
    ...entry, realmId: 'realm', messageId: 'message', attachmentId: 'attachment',
  })).resolves.toBeNull();
  expect(fetchMedia).toHaveBeenCalledTimes(2);
  expect(fetchMedia).toHaveBeenNthCalledWith(1, expect.stringMatching(/storage\.yandexcloud\.net/), expect.any(Object));
  expect(fetchMedia).toHaveBeenNthCalledWith(2, '/api/discussion-media/read', expect.objectContaining({ method: 'POST' }));
});
