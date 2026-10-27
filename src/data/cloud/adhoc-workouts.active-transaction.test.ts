import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import roles from '../../../cloud/roles.json';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import { CLOUD_DATABASE_STORES_V12, type MezfitCloudDatabase } from './database';
import { AdHocWorkoutRepository } from './adhoc-workouts';

const databases: Dexie[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) await db.delete();
});

async function fixture() {
  const db = new Dexie('adhoc-active-transaction-' + crypto.randomUUID(), { addons: [] });
  databases.push(db);
  const stores: Record<string, string | null> = {};
  for (const [table, schema] of Object.entries(CLOUD_DATABASE_STORES_V12)) {
    stores[table] = schema?.replaceAll('@', '') ?? null;
  }
  db.version(12).stores({ ...stores, localProgramSync: 'id' });
  for (const table of ['adHocSessions', 'trainingPlans', 'programPhases', 'programDays']) {
    db.table(table).hook('creating', key => key === undefined ? crypto.randomUUID() : undefined);
  }
  const pair = await relationshipMembership('101', '202');
  await db.table('realms').add(pair.realm);
  await db.table('members').bulkAdd(pair.members);
  await db.table('roles').put({ realmId: 'rlm-public', name: 'coach', ...roles.roles.coach });
  return { db, pair, repo: new AdHocWorkoutRepository(db as MezfitCloudDatabase, 'tg:101') };
}

describe('getActive transaction lifetime across row ordering', () => {
  it.each(['shared first', 'personal first'] as const)(
    'keeps Dexie transaction alive after inaccessible rows: %s', async order => {
      const { db, pair, repo } = await fixture();

      if (order === 'shared first') {
        const shared = await repo.createForAthlete('tg:202');
        await db.table('members').delete(pair.members[1].id);
        for (let attempt = 0; attempt < 8; attempt += 1) {
          expect(await repo.getActive()).toBeNull();
        }
        const personal = await repo.createQuick();
        for (let attempt = 0; attempt < 8; attempt += 1) {
          expect((await repo.getActive())?.id).toBe(personal.id);
        }
        await db.table('adHocSessions').update(personal.id, { owner: 'tg:303' });
        expect(await repo.getActive()).toBeNull();
        const replacement = await repo.createQuick();
        expect((await repo.getActive())?.id).toBe(replacement.id);
        expect(await repo.get(shared.id)).toBeNull();
      } else {
        const personal = await repo.createQuick();
        await db.table('adHocSessions').update(personal.id, { owner: 'tg:303' });
        expect(await repo.getActive()).toBeNull();
        const shared = await repo.createForAthlete('tg:202');
        for (let attempt = 0; attempt < 8; attempt += 1) {
          expect((await repo.getActive())?.id).toBe(shared.id);
        }
        await db.table('members').delete(pair.members[1].id);
        for (let attempt = 0; attempt < 8; attempt += 1) {
          expect(await repo.getActive()).toBeNull();
        }
        const replacement = await repo.createQuick();
        expect((await repo.getActive())?.id).toBe(replacement.id);
        expect(await repo.get(shared.id)).toBeNull();
      }

      // Inaccessible workouts must not be deleted or rewritten by the active-session guard.
      expect(await db.table('adHocSessions').count()).toBe(3);
    },
  );
});
