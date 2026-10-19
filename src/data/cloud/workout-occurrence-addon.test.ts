// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import dexieCloud from 'dexie-cloud-addon';
import { afterEach, describe, expect, it, vi } from 'vitest';

const databases: Dexie[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) await db.delete();
  vi.unstubAllGlobals();
});

describe('pinned Addon shared occurrence ownership', () => {
  it('preserves a realm owner without making either participant the object owner', async () => {
    const fetch = vi.fn(() => Promise.reject(new Error('Network must not be used')));
    vi.stubGlobal('fetch', fetch);
    const db = new Dexie('occurrence-addon-' + crypto.randomUUID(), { addons: [dexieCloud] });
    databases.push(db);
    db.version(1).stores({ workoutOccurrences: '@id, realmId' });
    // A local-only Addon instance exercises its actual middleware without authentication/network.
    db.cloud.configure({ databaseUrl: '', requireAuth: false, disableEagerSync: true, disableWebSocket: true, tryUseServiceWorker: false });
    const table = db.table('workoutOccurrences');
    const realmId = 'rlm' + 'a'.repeat(28);
    const missingOwnerId = await table.add({ realmId, owner: null });
    const implicit = await table.get(missingOwnerId);
    expect(implicit.owner).not.toBeNull(); // 4.4.15 replaces falsy ownership.
    const sharedId = await table.add({ realmId, owner: realmId });
    const shared = await table.get(sharedId);
    expect(shared.owner).toBe(realmId);
    expect(shared.owner).not.toBe('tg:101');
    expect(shared.owner).not.toBe('tg:202');
    expect(shared.owner).not.toBe(db.cloud.currentUserId);
    expect(fetch).not.toHaveBeenCalled();
  });
});
