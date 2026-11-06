import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { CLOUD_DATABASE_STORES_V14, CLOUD_DATABASE_STORES_V15, CLOUD_DATABASE_VERSION,
  CLOUD_DISCUSSION_DATABASE_VERSION, MezfitCloudDatabase } from './database';
import { DISCUSSION_STORES } from './discussion-contracts';
import manifest from '../../../cloud/schema-discussions.json';
const databases: Dexie[] = [];
afterEach(async () => { for (const db of databases.splice(0)) { db.close(); await db.delete(); } });

describe('additive opt-in discussion schema', () => {
  it('retains v14 records on v15 upgrade and supports realm/thread read indexes', async () => {
    const name = 'discussion-upgrade-' + crypto.randomUUID();
    const old = new Dexie(name); databases.push(old);
    old.version(14).stores(CLOUD_DATABASE_STORES_V14);
    await old.table('trainingPlans').put({ id: 'preserved', realmId: 'tg:1', name: 'Existing prescription' });
    old.close();
    const upgraded = new Dexie(name); databases.push(upgraded);
    upgraded.version(14).stores(CLOUD_DATABASE_STORES_V14);
    upgraded.version(15).stores(CLOUD_DATABASE_STORES_V15);
    await upgraded.open();
    expect((await upgraded.table('trainingPlans').get('preserved')).name).toBe('Existing prescription');
    await upgraded.table('discussionMessages').bulkAdd([
      { id: 'a', realmId: 'pair-a', threadId: 'thread' }, { id: 'b', realmId: 'pair-b', threadId: 'thread' },
    ]);
    expect((await upgraded.table('discussionMessages').where('[realmId+threadId]').equals(['pair-a', 'thread']).toArray()).map(row => row.id)).toEqual(['a']);
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
