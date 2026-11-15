import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, expect, it } from 'vitest';
import { rememberMediaReplica, confirmMediaReplica, publishMediaReplica, listIncompleteMediaReplicas,
  getMediaReplica, storeDiscussionMedia, readDiscussionMedia } from './discussionMediaCache';

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
