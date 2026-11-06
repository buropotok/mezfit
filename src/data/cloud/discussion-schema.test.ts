// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import dexieCloud from 'dexie-cloud-addon';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLOUD_DATABASE_STORES_V14, CLOUD_DATABASE_STORES_V15, CLOUD_DATABASE_VERSION,
  CLOUD_DISCUSSION_DATABASE_VERSION, MezfitCloudDatabase } from './database';
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
  it('does not advertise new tables to sealed cloud from the existing default application path', () => {
    const current = new MezfitCloudDatabase('123456', 'signed'); databases.push(current);
    const opted = new MezfitCloudDatabase('123457', 'signed', { discussions: true }); databases.push(opted);
    expect(current.verno).toBe(CLOUD_DATABASE_VERSION);
    expect(current.tables.some(table => table.name === 'discussionMessages')).toBe(false);
    expect(opted.verno).toBe(CLOUD_DISCUSSION_DATABASE_VERSION);
    expect(opted.tables.some(table => table.name === 'discussionMessages')).toBe(true);
    for (const [name, spec] of Object.entries(CLOUD_DATABASE_STORES_V14)) expect(CLOUD_DATABASE_STORES_V15[name as keyof typeof CLOUD_DATABASE_STORES_V14]).toBe(spec);
  });
});
