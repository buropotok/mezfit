// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import dexieCloud from 'dexie-cloud-addon';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLOUD_DATABASE_STORES_V14, CLOUD_DATABASE_STORES_V15, CLOUD_DATABASE_STORES_V17, CLOUD_DATABASE_VERSION,
  CLOUD_DISCUSSION_DATABASE_VERSION, CLOUD_DATABASE_STORES_V18, MezfitCloudDatabase } from './database';
import { DISCUSSION_STORES } from './discussion-contracts';
import manifest from '../../../cloud/schema-discussions.json';
const databases: Dexie[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) { db.close(); await db.delete(); }
  vi.unstubAllGlobals();
});

function offlineDatabase(name: string) {
  const db = new Dexie(name, { addons: [dexieCloud] }); databases.push(db);
  db.cloud.configure({ databaseUrl: '', requireAuth: false, disableEagerSync: true,
    disableWebSocket: true, tryUseServiceWorker: false,
    unsyncedTables: ['localWorkoutOccurrenceDrafts'] });
  return db;
}

describe('additive opt-in discussion schema', () => {
  it('retains v14 records on v15 upgrade and supports realm/thread read indexes', async () => {
    const fetch = vi.fn(() => Promise.reject(new Error('Network must not be used')));
    vi.stubGlobal('fetch', fetch);
    const name = 'discussion-upgrade-' + crypto.randomUUID();
    const old = offlineDatabase(name);
    old.version(14).stores(CLOUD_DATABASE_STORES_V14);
    const planId = await old.table('trainingPlans').add({ realmId: 'tg:1', owner: 'tg:1', name: 'Existing prescription' });
    old.close();
    const upgraded = offlineDatabase(name);
    upgraded.version(14).stores(CLOUD_DATABASE_STORES_V14);
    upgraded.version(15).stores(CLOUD_DATABASE_STORES_V15);
    await upgraded.open();
    expect((await upgraded.table('trainingPlans').get(planId)).name).toBe('Existing prescription');
    // Seed synchronized rows without unauthenticated Addon owner/realm rewriting.
    await new Promise<void>((resolve, reject) => {
      const tx = upgraded.backendDB().transaction('discussionMessages', 'readwrite');
      const messages = tx.objectStore('discussionMessages');
      messages.put({ id: 'a', realmId: 'pair-a', threadId: 'thread' });
      messages.put({ id: 'b', realmId: 'pair-b', threadId: 'thread' });
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    });
    expect((await upgraded.table('discussionMessages').where('[realmId+threadId]').equals(['pair-a', 'thread']).toArray()).map(row => row.id)).toEqual(['a']);
    expect(fetch).not.toHaveBeenCalled();
    for (const [table, key] of Object.entries(manifest.schema)) {
      expect(DISCUSSION_STORES[table as keyof typeof DISCUSSION_STORES].split(',')[0]).toBe(key);
    }
  });
  it('opens a previous local database without importing retired drafts or losing cached relationship rows', async () => {
    const fetch = vi.fn(() => Promise.reject(new Error('Offline')));
    vi.stubGlobal('fetch', fetch);
    const telegramUserId = String(9000000000 + Math.floor(Math.random() * 100000000));
    const name = 'mezfit-cloud:' + telegramUserId;
    const old = offlineDatabase(name);
    old.version(17).stores({ ...CLOUD_DATABASE_STORES_V17, localProgramSync: 'id', localWorkoutSync: 'id' });
    await old.open();
    await new Promise<void>((resolve, reject) => {
      const tx = old.backendDB().transaction(['realms', 'members', 'localWorkoutOccurrenceDrafts'], 'readwrite');
      tx.objectStore('realms').put({ realmId: 'rlm-cached', owner: null });
      tx.objectStore('members').put({ id: 'mmb-cached', realmId: 'rlm-cached', userId: 'tg:' + telegramUserId });
      tx.objectStore('localWorkoutOccurrenceDrafts').put({ id: 'retired-draft' });
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    });
    old.close();

    const current = new MezfitCloudDatabase(telegramUserId, 'signed'); databases.push(current);
    current.cloud.configure({ databaseUrl: '', requireAuth: false, disableEagerSync: true,
      disableWebSocket: true, tryUseServiceWorker: false,
      unsyncedTables: ['localProgramSync', 'localWorkoutSync'] });
    await current.open();
    expect(current.verno).toBe(18);
    expect(current.tables.some(table => table.name === 'localWorkoutOccurrenceDrafts')).toBe(false);
    expect((await current.realms.toArray()).map(row => row.realmId)).toContain('rlm-cached');
    expect((await current.members.toArray()).map(row => row.id)).toContain('mmb-cached');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('registers discussions by default and retains an explicit historical-schema fixture', () => {
    const current = new MezfitCloudDatabase('123456', 'signed'); databases.push(current);
    const opted = new MezfitCloudDatabase('123457', 'signed', { discussions: false }); databases.push(opted);
    expect(current.verno).toBe(CLOUD_DISCUSSION_DATABASE_VERSION);
    expect(current.tables.some(table => table.name === 'discussionMessages')).toBe(true);
    expect(current.tables.some(table => table.name === 'localWorkoutOccurrenceDrafts')).toBe(false);
    expect(CLOUD_DATABASE_STORES_V18.localWorkoutOccurrenceDrafts).toBeNull();
    expect(opted.verno).toBe(CLOUD_DATABASE_VERSION);
    expect(opted.tables.some(table => table.name === 'discussionMessages')).toBe(false);
    for (const [name, spec] of Object.entries(CLOUD_DATABASE_STORES_V14)) expect(CLOUD_DATABASE_STORES_V15[name as keyof typeof CLOUD_DATABASE_STORES_V14]).toBe(spec);
  });
});
