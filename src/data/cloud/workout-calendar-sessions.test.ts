import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, expect, it } from 'vitest';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import { CLOUD_DATABASE_STORES_V12, type MezfitCloudDatabase } from './database';
import { AdHocWorkoutRepository } from './adhoc-workouts';
import type { AdHocSessionRow } from './adhoc-workout-types';
import { bookingsShareParticipant } from './workout-slot-validation';

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
  expect(await coach.listForCalendar()).toEqual([{ ...session, format: 'coached' }]);
  expect(await client.listForCalendar()).toEqual([{ ...session, format: 'coached' }]);
  expect(await foreign.listForCalendar()).toEqual([]);
  expect((await coach.get(session.id))?.plannedTiming).toEqual({ startsAtUtc: '2026-10-29T08:00:00.000Z', durationMinutes: 60 });
  expect((await db.table('workoutOccurrences').get('booking')).startsAtUtc).toBe('2026-10-29T08:00:00.000Z');
  await db.table('workoutOccurrences').update('booking', { format: 'independent' });
  const [independent] = await coach.listForCalendar();
  expect(independent.format).toBe('independent');
  expect((await client.listForCalendar())[0].format).toBe('independent');
  const executionBooking = { ...independent, startsAtUtc: independent.startedAt, durationMinutes: 40 };
  expect(bookingsShareParticipant(executionBooking, { athleteUserId: 'tg:101', coachUserId: null,
    format: 'independent', startsAtUtc: independent.startedAt, durationMinutes: 60 })).toBe(false);
  expect(bookingsShareParticipant(executionBooking, { athleteUserId: 'tg:202', coachUserId: null,
    format: 'independent', startsAtUtc: independent.startedAt, durationMinutes: 60 })).toBe(true);
  // Partial replication may deliver the reverse link after the execution header.
  await db.table('workoutOccurrences').update('booking', { workoutSessionId: null });
  expect((await coach.listForCalendar())[0].format).toBe('independent');
  // A conflicting reverse link must not supply another execution's format.
  await db.table('workoutOccurrences').update('booking', { workoutSessionId: 'other-session' });
  expect((await coach.listForCalendar())[0].format).toBe('coached');
  await db.table('members').delete(pair.members[1].id);
  expect(await coach.listForCalendar()).toEqual([]);
  expect(await client.listForCalendar()).toEqual([]);
});
