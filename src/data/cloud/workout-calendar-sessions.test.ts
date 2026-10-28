import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, expect, it } from 'vitest';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import { CLOUD_DATABASE_STORES_V12, type MezfitCloudDatabase } from './database';
import { AdHocWorkoutRepository } from './adhoc-workouts';
import type { AdHocSessionRow } from './adhoc-workout-types';

const databases: Dexie[] = [];
afterEach(async () => { for (const db of databases.splice(0)) await db.delete(); });
it('projects authorized completed history and its original schedule without rewriting PLAN timing', async () => {
  const db = new Dexie('calendar-session-headers-' + crypto.randomUUID(), { addons: [] });
  databases.push(db);
  const stores: Record<string, string | null> = {};
  for (const [table, schema] of Object.entries(CLOUD_DATABASE_STORES_V12)) stores[table] = schema?.replaceAll('@', '') ?? null;
  db.version(12).stores({ ...stores, localProgramSync: 'id', localWorkoutSync: 'id' });
  const pair = await relationshipMembership('101', '202');
  await db.table('realms').put(pair.realm); await db.table('members').bulkPut(pair.members);
  const plan = { name: 'День', comment: null, exercises: [] };
  const session: AdHocSessionRow = { id: 'session', realmId: pair.realm.realmId, owner: pair.realm.realmId,
    athleteUserId: 'tg:202', coachUserId: 'tg:101', clientUserId: 'tg:202', creatorUserId: 'tg:101',
    name: 'День', comment: null, programName: null, autoCreatedProgram: false,
    occurrenceId: 'booking', occurrencePlan: plan, status: 'completed',
    startedAt: '2026-10-28T10:05:00.000Z', completedAt: '2026-10-28T10:45:00.000Z',
    createdAt: '2026-10-28T10:05:00.000Z', updatedAt: '2026-10-28T10:45:00.000Z' };
  await db.table('adHocSessions').put(session);
  await db.table('workoutOccurrences').put({ id: 'booking', realmId: pair.realm.realmId, owner: null,
    athleteUserId: 'tg:202', coachUserId: 'tg:101', clientUserId: 'tg:202', format: 'coached',
    status: 'completed', workoutSessionId: session.id, startsAtUtc: '2026-10-29T08:00:00.000Z', durationMinutes: 60, plan });
  const database = db as MezfitCloudDatabase;
  const coach = new AdHocWorkoutRepository(database, 'tg:101');
  const client = new AdHocWorkoutRepository(database, 'tg:202');
  const foreign = new AdHocWorkoutRepository(database, 'tg:303');
  expect(await coach.listForCalendar()).toEqual([session]);
  expect(await client.listForCalendar()).toEqual([session]);
  expect(await foreign.listForCalendar()).toEqual([]);
  expect((await coach.get(session.id))?.plannedTiming).toEqual({ startsAtUtc: '2026-10-29T08:00:00.000Z', durationMinutes: 60 });
  expect((await db.table('workoutOccurrences').get('booking')).startsAtUtc).toBe('2026-10-29T08:00:00.000Z');
  await db.table('members').delete(pair.members[1].id);
  expect(await coach.listForCalendar()).toEqual([]);
  expect(await client.listForCalendar()).toEqual([]);
});
