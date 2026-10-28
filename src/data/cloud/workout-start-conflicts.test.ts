import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import roles from '../../../cloud/roles.json';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import { CLOUD_DATABASE_STORES_V12, type MezfitCloudDatabase } from './database';
import { AdHocWorkoutRepository } from './adhoc-workouts';
import { PlannedWorkoutConflict } from './planned-workout-conflicts';
import { WorkoutOccurrenceDraftRepository } from './workout-occurrence-drafts';
import type { CloudWorkoutOccurrenceRow } from './workout-foundation-types';

const databases: Dexie[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const db of databases.splice(0)) await db.delete();
});
async function fixture() {
  const db = new Dexie('all-start-conflicts-' + crypto.randomUUID(), { addons: [] });
  databases.push(db);
  const stores: Record<string, string | null> = {};
  for (const [table, schema] of Object.entries(CLOUD_DATABASE_STORES_V12)) stores[table] = schema?.replaceAll('@', '') ?? null;
  db.version(12).stores({ ...stores, localProgramSync: 'id', localWorkoutSync: 'id' });
  for (const table of ['adHocSessions', 'adHocExercises', 'adHocSets', 'trainingPlans', 'programPhases', 'programDays'])
    db.table(table).hook('creating', key => key === undefined ? crypto.randomUUID() : undefined);
  for (const client of ['202', '303']) {
    const pair = await relationshipMembership('101', client);
    await db.table('realms').put(pair.realm);
    await db.table('members').bulkPut(pair.members);
    if (client === '303') await db.table('workoutOccurrences').put({
      id: 'occupied', realmId: pair.realm.realmId, owner: null,
      athleteUserId: 'tg:303', coachUserId: 'tg:101', clientUserId: 'tg:303', format: 'coached',
      status: 'scheduled', workoutSessionId: null, startsAtUtc: '2026-10-28T05:30:00.000Z', durationMinutes: 60,
      plan: { name: 'Назначенная тренировка', comment: null, exercises: [] },
    });
  }
  const coach = roles.roles.coach;
  await db.table('roles').put({ realmId: 'rlm-public', name: 'coach', ...coach,
    permissions: { ...coach.permissions, add: [...coach.permissions.add, 'adHocSessions', 'adHocExercises', 'adHocSets'],
      update: { ...coach.permissions.update, workoutOccurrences: [...coach.permissions.update.workoutOccurrences, 'status', 'workoutSessionId'] } } });
  // Freeze Date only: IndexedDB's task scheduling remains real.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-28T05:58:00.000Z'));
  const database = db as MezfitCloudDatabase;
  return { db, repo: new AdHocWorkoutRepository(database, 'tg:101'), drafts: new WorkoutOccurrenceDraftRepository(database, 'tg:101') };
}
const graphTables = ['trainingPlans', 'programPhases', 'programDays', 'adHocSessions', 'adHocExercises', 'adHocSets'];
const counts = (db: Dexie) => Promise.all(graphTables.map(table => db.table(table).count()));

describe('atomic conflict checks for every Coach Start', () => {
  it.each(['quick', 'new-client-program', 'existing-program', 'planned'] as const)(
    'rejects %s without persisting a graph, then starts after explicit cancellation', async kind => {
      const { db, repo, drafts } = await fixture();
      let programId: string | undefined, dayId: string | undefined;
      if (kind === 'existing-program') {
        programId = await repo.programs.createAssigned('tg:202', 'Программа');
        const phase = (await repo.programs.details(programId))?.phases[0];
        if (!phase) throw new Error('Missing phase');
        dayId = await repo.programs.createDay(programId, phase.id, 'День');
      }
      if (kind === 'planned') {
        const personal: CloudWorkoutOccurrenceRow = {
          id: 'selected', realmId: 'tg:101', owner: 'tg:101', athleteUserId: 'tg:101',
          coachUserId: null, clientUserId: null, format: 'independent', status: 'scheduled', workoutSessionId: null,
          startsAtUtc: '2026-10-29T08:00:00.000Z', durationMinutes: 60,
          plan: { name: 'Моя тренировка', comment: null, exercises: [] },
        };
        await db.table('workoutOccurrences').put(personal);
      }
      const start = () => kind === 'quick' ? repo.createQuick()
        : kind === 'planned' ? repo.createFromOccurrence('selected')
          : repo.createForAthlete('tg:202', programId, dayId);
      const before = await counts(db);
      await expect(start()).rejects.toBeInstanceOf(PlannedWorkoutConflict);
      expect(await counts(db)).toEqual(before);
      expect(await db.table('workoutOccurrences').get('occupied')).toMatchObject({ status: 'scheduled', workoutSessionId: null });
      await drafts.cancel('occupied');
      const session = await start();
      expect((await repo.getRow(session.id))?.startedAt).toBe('2026-10-28T05:58:00.000Z');
      expect(await db.table('adHocSessions').count()).toBe(1);
    },
  );
  it('preserves the same-athlete case without cancelling the booking', async () => {
    const { db, repo } = await fixture();
    await db.table('workoutOccurrences').update('occupied', { athleteUserId: 'tg:202', clientUserId: 'tg:202' });
    // Use the correct relationship realm for the new athlete.
    const pair = await relationshipMembership('101', '202');
    await db.table('workoutOccurrences').update('occupied', { realmId: pair.realm.realmId });
    await expect(repo.createForAthlete('tg:202')).resolves.toMatchObject({ createdProgram: true });
    expect((await db.table('workoutOccurrences').get('occupied')).cancelledAt).toBeUndefined();
  });
  it.each([
    { format: 'independent' }, { inactive: true }, { cancelledAt: '2026-10-28T05:00:00.000Z' },
    { startsAtUtc: '2026-10-28T06:30:00.000Z' }, { startsAtUtc: '2026-10-28T04:58:00.000Z' },
  ])('allows quick Start when the booking does not occupy the coach now: %j', async changes => {
    const { db, repo } = await fixture();
    await db.table('workoutOccurrences').update('occupied', changes);
    await expect(repo.createQuick()).resolves.toMatchObject({ createdProgram: false });
  });
  it('does not ask to cancel bookings for an invalid program selection', async () => {
    const { repo } = await fixture();
    await expect(repo.createForAthlete('tg:202', 'missing')).rejects.toThrow('ADHOC_PROGRAM_NOT_FOUND');
  });
});
