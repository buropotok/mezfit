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
  const tracked = databases.splice(0);
  for (const db of tracked) db.close();
  for (const db of tracked) await db.delete();
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
  it('removes only the obsolete local draft store on v17 to v18 IndexedDB upgrade', async () => {
    // Test the physical IndexedDB schema upgrade without Dexie Cloud's
    // authenticated realm filtering, which is not under test here.
    const name = 'local-store-retirement-' + crypto.randomUUID();
    const localSchema = (stores: Record<string, string | null>) =>
      Object.fromEntries(Object.entries(stores).map(([table, spec]) => [
        table, spec === null ? null : spec.replaceAll('@', ''),
      ]));
    const old = new Dexie(name); databases.push(old);
    old.version(17).stores(localSchema(CLOUD_DATABASE_STORES_V17));
    await old.open();
    await old.table('realms').put({ realmId: 'rlm-cached', owner: null });
    await old.table('members').put({ id: 'mmb-cached', realmId: 'rlm-cached', userId: 'tg:101' });
    await old.table('workoutOccurrences').put({ id: 'occ-cached', realmId: 'rlm-cached' });
    await old.table('localWorkoutOccurrenceDrafts').put({ id: 'retired-draft' });
    old.close();

    const current = new Dexie(name); databases.push(current);
    current.version(17).stores(localSchema(CLOUD_DATABASE_STORES_V17));
    current.version(18).stores(localSchema(CLOUD_DATABASE_STORES_V18));
    await current.open();

    expect(current.verno).toBe(18);
    expect(current.tables.some(table => table.name === 'localWorkoutOccurrenceDrafts')).toBe(false);
    expect(await current.table('realms').get('rlm-cached')).toMatchObject({ realmId: 'rlm-cached' });
    expect(await current.table('members').get('mmb-cached')).toMatchObject({ id: 'mmb-cached' });
    expect(await current.table('workoutOccurrences').get('occ-cached')).toMatchObject({ id: 'occ-cached' });
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
