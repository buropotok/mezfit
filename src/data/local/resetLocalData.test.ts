// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { completePendingLocalDataReset, requestLocalDataReset } from './resetLocalData';

const account = '9401';
const other = '9402';
const owned = ['mezfit-cloud:' + account, 'mezfit-local:' + account];
const media = 'mezfit-discussion-media:tg:' + account;
const publicMedia = 'mezfit-base2-public-media-v1';
const otherCloud = 'mezfit-cloud:' + other;

async function seed(name: string) {
  const db = new Dexie(name);
  db.version(1).stores({ items: 'id' });
  try { await db.table('items').put({ id: 'persisted' }); } finally { db.close(); }
}

beforeEach(() => sessionStorage.clear());
afterEach(async () => {
  sessionStorage.clear();
  await Promise.all([...owned, media, publicMedia, otherCloud].map(name => Dexie.delete(name)));
});

it('deletes only the current account working data before the application mounts', async () => {
  for (const name of [...owned, otherCloud]) await seed(name);
  requestLocalDataReset(account, { media: false, workouts: true });
  expect(await completePendingLocalDataReset()).toBe(true);

  for (const name of owned) expect(await Dexie.exists(name)).toBe(false);
  expect(await Dexie.exists(otherCloud)).toBe(true);
  expect(await completePendingLocalDataReset()).toBe(false);
});

it('clears media cache but keeps original files required for unfinished replica tasks', async () => {
  const db = new Dexie(media);
  db.version(1).stores({ files: '&key' });
  db.version(2).stores({ files: '&key', replicas: '&key' });
  try {
    await db.table('files').bulkPut([
      { key: 'cached', blob: new Blob(['cache']) },
      { key: 'in-progress', blob: new Blob(['original']) },
    ]);
    await db.table('replicas').put({ key: 'in-progress', published: false });
  } finally { db.close(); }
  await seed(publicMedia);

  requestLocalDataReset(account, { media: true, workouts: false });
  expect(await completePendingLocalDataReset()).toBe(true);

  expect(await Dexie.exists(publicMedia)).toBe(false);
  expect(await Dexie.exists(media)).toBe(true);
  expect(await db.table('files').get('cached')).toBeUndefined();
  expect(await db.table('files').get('in-progress')).toBeDefined();
  expect(await db.table('replicas').get('in-progress')).toBeDefined();
  db.close();
});

it('rejects empty selections and invalid accounts without deleting anything', async () => {
  await seed(otherCloud);
  expect(() => requestLocalDataReset('0', { media: true, workouts: false })).toThrow();
  expect(() => requestLocalDataReset(account, { media: false, workouts: false })).toThrow();
  expect(await completePendingLocalDataReset()).toBe(false);
  expect(await Dexie.exists(otherCloud)).toBe(true);
});
