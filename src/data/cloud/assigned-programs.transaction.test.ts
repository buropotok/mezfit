import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import { isApprovedAssignedPair } from './assigned-programs';

const databases: Dexie[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) await db.delete();
});

describe('relationship authorization transaction lifetime', () => {
  it.each(['approved', 'revoked', 'forged member', 'foreign realm'] as const)(
    'keeps delayed WebCrypto inside the transaction for %s relationships',
    async (state) => {
      const pair = await relationshipMembership('101', '202');
      const db = new Dexie('relationship-lifetime-' + crypto.randomUUID(), { addons: [] });
      databases.push(db);
      db.version(1).stores({ probe: 'id' });
      await db.table('probe').put({ id: 'result', approved: null });
      const realm = state === 'foreign realm' ? { ...pair.realm, realmId: 'rlm-foreign' } : pair.realm;
      const members = state === 'revoked' ? pair.members.slice(0, 1)
        : state === 'forged member' ? pair.members.map((member, index) =>
          index === 1 ? { ...member, id: 'mmb-forged' } : member)
        : pair.members;
      const digest = crypto.subtle.digest.bind(crypto.subtle);
      // A real task boundary reproduces WebCrypto finishing outside IDB request
      // callbacks. Keep the real hash and all authorization checks.
      vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, data) => {
        await new Promise<void>(resolve => setTimeout(resolve, 5));
        return digest(algorithm, data);
      });
      const expected = state === 'approved';
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await db.transaction('r', 'probe', async () => {
          await db.table('probe').get('result');
          return isApprovedAssignedPair(realm, members, 'tg:101', 'tg:202');
        });
        expect(result).toBe(expected);
        await db.transaction('rw', 'probe', async () => {
          await db.table('probe').get('result');
          const approved = await isApprovedAssignedPair(realm, members, 'tg:101', 'tg:202');
          await db.table('probe').put({ id: 'result', approved });
        });
        expect(await db.table('probe').get('result')).toEqual({ id: 'result', approved: expected });
      }
    },
  );
});
