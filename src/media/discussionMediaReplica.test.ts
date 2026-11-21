import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, expect, it } from 'vitest';
import { rememberMediaReplica, confirmMediaReplica, publishMediaReplica, listIncompleteMediaReplicas,
  getMediaReplica, storeDiscussionMedia, readDiscussionMedia, storeDiscussionPhoto,
  reconcilePublishedPhotoReplicas, clearDiscussionMediaCache } from './discussionMediaCache';

const entry = { accountId: 'tg:702', storageKey: 'mvp-media/' + 'b'.repeat(64),
  mimeType: 'video/mp4', sizeBytes: 6 };
afterEach(async () => { await Dexie.delete('mezfit-discussion-media:' + entry.accountId); });

it('survives a fresh Dexie handle with one pending replica and the same bytes', async () => {
  const file = new Blob(['sample'], { type: 'video/mp4' });
  await storeDiscussionMedia(entry, file, true);
  await rememberMediaReplica(entry, 'movie.mp4');
  expect(await listIncompleteMediaReplicas(entry.accountId)).toEqual([]);
  await confirmMediaReplica(entry.accountId, entry.storageKey, 'r2');
  await publishMediaReplica(entry.accountId, entry.storageKey);
  expect(await getMediaReplica(entry.accountId, entry.storageKey))
    .toMatchObject({ r2ConfirmedAt: expect.any(String), published: true });
  expect((await listIncompleteMediaReplicas(entry.accountId))[0]).toMatchObject({
    storageKey: entry.storageKey, fileName: 'movie.mp4', yandexConfirmedAt: undefined,
  });
  expect(await (await readDiscussionMedia(entry))?.text()).toBe('sample');
  await confirmMediaReplica(entry.accountId, entry.storageKey, 'yandex');
  expect(await listIncompleteMediaReplicas(entry.accountId)).toEqual([]);
});

it('upgrades a legacy v1 media cache without deleting the previously stored file', async () => {
  const legacy = new Dexie('mezfit-discussion-media:' + entry.accountId);
  legacy.version(1).stores({ files: '&key' });
  try {
    await legacy.table('files').put({
      key: entry.storageKey, blob: new Blob(['sample'], { type: entry.mimeType }),
    });
  } finally {
    legacy.close();
  }
  await rememberMediaReplica(entry, 'movie.mp4');
  expect(await (await readDiscussionMedia(entry))?.text()).toBe('sample');
  expect(await getMediaReplica(entry.accountId, entry.storageKey)).toMatchObject({
    fileName: 'movie.mp4', published: false,
  });
});

it('refuses to reuse a replica key for different file metadata', async () => {
  await rememberMediaReplica(entry, 'movie.mp4');
  await expect(rememberMediaReplica({ ...entry, sizeBytes: 7 }, 'movie.mp4'))
    .rejects.toThrow('MEDIA_REPLICA_MISMATCH');
});

it('retains both photo bytes through retries and deletes only Full after publication and four confirmations', async () => {
  const accountId = entry.accountId;
  const prefix = 'mvp-media/' + 'a'.repeat(64);
  const photoId = 'b'.repeat(64);
  const full = { accountId, storageKey: `${prefix}/full/${photoId}`, mimeType: 'image/jpeg', sizeBytes: 6 };
  const preview = { accountId, storageKey: `${prefix}/preview/${photoId}`, mimeType: 'image/webp', sizeBytes: 3 };
  await storeDiscussionPhoto(full, new Blob(['sample'], { type: full.mimeType }),
    preview, new Blob(['web'], { type: preview.mimeType }));
  await rememberMediaReplica(full, 'photo.jpg');
  await rememberMediaReplica(preview, 'preview.webp');
  for (const object of [full, preview]) await confirmMediaReplica(accountId, object.storageKey, 'yandex');
  await confirmMediaReplica(accountId, full.storageKey, 'r2');
  expect(await readDiscussionMedia(full)).not.toBeNull();
  expect(await listIncompleteMediaReplicas(accountId)).toEqual([]);

  // Simulate a reload after the repository published but before the local queue was marked.
  await reconcilePublishedPhotoReplicas(accountId, async key => key === full.storageKey);
  expect((await listIncompleteMediaReplicas(accountId)).map(task => task.storageKey)).toEqual([preview.storageKey]);
  expect(await readDiscussionMedia(full)).not.toBeNull();
  await confirmMediaReplica(accountId, preview.storageKey, 'r2');
  expect(await readDiscussionMedia(full)).toBeNull();
  expect(await (await readDiscussionMedia(preview))?.text()).toBe('web');
  expect(await getMediaReplica(accountId, full.storageKey)).toBeNull();
  expect(await listIncompleteMediaReplicas(accountId)).toEqual([]);
});

it.each(['yandex', 'r2'] as const)(
  'drops the temporary Full copy after both variants are published using %s without mirroring',
  async provider => {
    const accountId = entry.accountId;
    const prefix = 'mvp-media/' + 'a'.repeat(64);
    const photoId = 'b'.repeat(64);
    const full = { accountId, storageKey: `${prefix}/full/${photoId}`, mimeType: 'image/jpeg', sizeBytes: 6 };
    const preview = { accountId, storageKey: `${prefix}/preview/${photoId}`, mimeType: 'image/webp', sizeBytes: 3 };
    await storeDiscussionPhoto(full, new Blob(['sample'], { type: full.mimeType }),
      preview, new Blob(['web'], { type: preview.mimeType }));
    await rememberMediaReplica(full, 'photo.jpg', true);
    await rememberMediaReplica(preview, 'preview.webp', true);
    for (const object of [full, preview]) await confirmMediaReplica(accountId, object.storageKey, provider);
    expect(await readDiscussionMedia(full)).not.toBeNull();

    await publishMediaReplica(accountId, full.storageKey);
    expect(await readDiscussionMedia(full)).toBeNull();
    expect(await (await readDiscussionMedia(preview))?.text()).toBe('web');
    expect(await listIncompleteMediaReplicas(accountId)).toEqual([]);
  },
);

it('protects both newly saved video variants from a cache reset during upload recovery', async () => {
  const accountId = entry.accountId;
  const storagePrefix = `mvp-media/${'a'.repeat(64)}`;
  const mediaId = 'c'.repeat(64);
  const full = { ...entry, storageKey: `${storagePrefix}/full/${mediaId}` };
  const preview = { accountId, storageKey: `${storagePrefix}/preview/${mediaId}`, mimeType: 'image/jpeg', sizeBytes: 3 };
  await storeDiscussionPhoto(full, new File(['sample'], 'movie.mp4', { type: full.mimeType }),
    preview, new Blob(['jpg'], { type: preview.mimeType }));
  await clearDiscussionMediaCache(accountId);
  expect(await (await readDiscussionMedia(full))?.text()).toBe('sample');
  expect(await (await readDiscussionMedia(preview))?.text()).toBe('jpg');
  for (const object of [full, preview]) {
    await confirmMediaReplica(accountId, object.storageKey, 'yandex');
    await confirmMediaReplica(accountId, object.storageKey, 'r2');
  }
  await publishMediaReplica(accountId, full.storageKey);
  expect(await readDiscussionMedia(full)).toBeNull();
  expect(await (await readDiscussionMedia(preview))?.text()).toBe('jpg');
});
