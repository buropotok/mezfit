import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, expect, it } from 'vitest';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import { CLOUD_DATABASE_STORES_V12, type MezfitCloudDatabase } from './database';
import { PlannedWorkoutsRepository } from './planned-workouts';
import type { CloudWorkoutOccurrenceRow } from './workout-foundation-types';
const databases: Dexie[] = [];
afterEach(async () => { for (const db of databases.splice(0)) await db.delete(); });
it('lists only the Client athlete’s published upcoming workouts in permitted realms', async () => {
  const db = new Dexie('planned-client-' + crypto.randomUUID(), { addons: [] });
  databases.push(db);
  const stores: Record<string, string | null> = {};
  for (const [table, schema] of Object.entries(CLOUD_DATABASE_STORES_V12)) stores[table] = schema?.replaceAll('@', '') ?? null;
  db.version(12).stores({ ...stores, localWorkoutSync: 'id', localProgramSync: 'id' });
  const pair = await relationshipMembership('101', '202');
  await db.table('realms').add(pair.realm); await db.table('members').bulkAdd(pair.members);
  const time = '2026-10-29T08:00:00.000Z';
  const plan = { name: 'День', comment: null, exercises: [] };
  const row: CloudWorkoutOccurrenceRow = { id: 'published', realmId: pair.realm.realmId, owner: pair.realm.realmId,
    athleteUserId: 'tg:202', coachUserId: 'tg:101', clientUserId: 'tg:202', format: 'independent',
    startsAtUtc: time, durationMinutes: 60, status: 'scheduled', workoutSessionId: null, plan,
    originalPlan: plan, publishedPlan: plan, publicationStatus: 'published', draftAuthorUserId: 'tg:101',
    createdByUserId: 'tg:101', createdAt: time, updatedAt: time };
  await db.table('workoutOccurrences').bulkAdd([row,
    { ...row, id: 'draft', publicationStatus: 'draft' },
    { ...row, id: 'inactive', inactive: true },
    { ...row, id: 'cancelled', cancelledAt: time },
    { ...row, id: 'future', startsAtUtc: '2026-12-01T08:00:00.000Z' },
  ]);
  const database = db as unknown as MezfitCloudDatabase;
  const client = new PlannedWorkoutsRepository(database, 'tg:202', 'client');
  expect((await client.list(new Date(time))).map(row => row.id)).toEqual(['published']);
  expect(await new PlannedWorkoutsRepository(database, 'tg:303', 'client').list(new Date(time))).toEqual([]);
  await db.table('members').delete(pair.members[1].id);
  expect(await client.list(new Date(time))).toEqual([]);
});
