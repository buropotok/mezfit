import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, expect, it, vi } from 'vitest';
import { downloadDiscussionMedia, readDiscussionMedia, storeDiscussionMedia } from './discussionMediaCache';

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
