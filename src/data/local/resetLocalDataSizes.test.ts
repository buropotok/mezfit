// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, expect, it } from 'vitest';
import { estimateLocalDataBytes, estimateMediaCacheBytes } from './resetLocalDataSizes';

const userId = '83219';
const otherId = '83220';
const localNames = [
  'mezfit-cloud:' + userId, 'mezfit-local:' + userId,
  'mezfit-cloud:' + otherId, 'mezfit-local:' + otherId,
];
const mediaName = 'mezfit-discussion-media:tg:' + userId;
const base2Name = 'mezfit-base2-public-media-v1';

afterEach(async () => {
  await Promise.all([...localNames, mediaName, base2Name].map(name => Dexie.delete(name)));
});

it('estimates removable media bytes but excludes protected replica originals', async () => {
  const discussion = new Dexie(mediaName);
  discussion.version(1).stores({ files: '&key' });
  discussion.version(2).stores({ files: '&key', replicas: '&key' });
  await discussion.table('files').bulkPut([
    { key: 'thumbnail', blob: new Blob(['a'.repeat(20000)]) },
    { key: 'upload-original', blob: new Blob(['b'.repeat(50000)]) },
  ]);
  await discussion.table('replicas').put({ key: 'upload-original', published: false });
  discussion.close();

  const exercise = new Dexie(base2Name);
  exercise.version(1).stores({ images: 'key' });
  await exercise.table('images').put({ key: 'gif', blob: new Blob(['c'.repeat(30000)]) });
  exercise.close();

  const mediaBytes = await estimateMediaCacheBytes(userId);
  expect(mediaBytes).toBeGreaterThanOrEqual(50000);
  expect(mediaBytes).toBeLessThan(51000);
});

it('counts all records in the selected account working databases without touching another account', async () => {
  const db = new Dexie('mezfit-cloud:' + userId);
  db.version(1).stores({ programs: 'id', sessions: 'id' });
  await db.table('programs').put({ id: 'a', title: 'тренировка'.repeat(500) });
  await db.table('sessions').put({ id: 'b', startedAt: '2026-11-20T10:00:00Z' });
  db.close();
  const another = new Dexie('mezfit-cloud:' + otherId);
  another.version(1).stores({ programs: 'id' });
  await another.table('programs').put({ id: 'x', title: 'x'.repeat(70000) });
  another.close();

  const size = await estimateLocalDataBytes(userId);
  expect(size).toBeGreaterThan(5000);
  expect(size).toBeLessThan(70000);
  expect(await estimateLocalDataBytes(otherId)).toBeGreaterThan(size);
});

it('does not create missing IndexedDB databases while measuring empty storage', async () => {
  expect(await estimateMediaCacheBytes(userId)).toBe(0);
  expect(await estimateLocalDataBytes(userId)).toBe(0);
  expect(await Dexie.exists(mediaName)).toBe(false);
  expect(await Dexie.exists(base2Name)).toBe(false);
  expect(await Dexie.exists('mezfit-cloud:' + userId)).toBe(false);
});

it('rejects invalid accounts before opening any database', async () => {
  await expect(estimateMediaCacheBytes('0')).rejects.toThrow('INVALID_LOCAL_DATABASE_USER_ID');
  await expect(estimateLocalDataBytes('../other')).rejects.toThrow('INVALID_LOCAL_DATABASE_USER_ID');
});
