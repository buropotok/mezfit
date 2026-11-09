import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import { AdHocWorkoutRepository } from './adhoc-workouts';
import type { AdHocSessionRow, AdHocExerciseRow, AdHocSetRow } from './adhoc-workout-types';
import type { MezfitCloudDatabase } from './database';

const databases: Dexie[] = [];
afterEach(async () => { for (const db of databases.splice(0)) await db.delete(); });

const date = '2026-11-08T12:00:00.000Z';
function session(id: string, realmId: string, coach: string | null,
  athlete = 'tg:202', creator = coach ?? athlete): AdHocSessionRow {
  return {
    id, realmId, owner: realmId, athleteUserId: athlete, coachUserId: coach,
    clientUserId: coach ? athlete : null, creatorUserId: creator, name: id, comment: null,
    programName: null, autoCreatedProgram: false, startedAt: date, completedAt: date,
    status: 'completed', createdAt: date, updatedAt: date,
  };
}
function exercise(id: string, sessionId: string, realmId: string,
  exerciseDefinitionId: string, deletedAt: string | null = null): AdHocExerciseRow {
  return {
    id, sessionId, realmId, owner: realmId, position: 0, notes: null, deletedAt,
    exercise: {
      exerciseDefinitionId, scope: 'public', name: exerciseDefinitionId, nameEn: null,
      mediaUrl: null, trackingType: 'weight_reps',
    },
  };
}
function fact(id: string, sessionId: string, exerciseId: string, realmId: string,
  setStatus: 'completed' | 'pending' = 'completed'): AdHocSetRow {
  return {
    id, sessionId, exerciseId, realmId, owner: realmId, position: 0, deletedAt: null,
    setType: null, actualReps: setStatus === 'completed' ? 8 : null,
    actualWeightKg: null, actualDurationSeconds: null, actualDistanceMeters: null,
    setLabel: null, rpe: null, comment: null, bands: [], setStatus,
  };
}
async function fixture() {
  const db = new Dexie('own-profile-exercises-' + crypto.randomUUID(), { addons: [] });
  databases.push(db);
  db.version(1).stores({
    realms: 'realmId', members: 'id, realmId, userId',
    adHocSessions: 'id, realmId, athleteUserId, startedAt',
    adHocExercises: 'id, realmId, sessionId',
    adHocSets: 'id, realmId, sessionId, exerciseId',
    publicExerciseDefinitions: 'id, realmId',
  });
  const first = await relationshipMembership('101', '202');
  const second = await relationshipMembership('303', '202');
  const foreign = await relationshipMembership('101', '404');
  for (const pair of [first, second, foreign]) {
    await db.table('realms').add(pair.realm);
    await db.table('members').bulkAdd(pair.members);
  }
  const repo = new AdHocWorkoutRepository(db as unknown as MezfitCloudDatabase, 'tg:202');
  return { db, repo, realmA: first.realm.realmId, realmB: second.realm.realmId, foreignRealm: foreign.realm.realmId };
}

describe('self profile performed FACT across all authorized realms', () => {
  it('combines own and both trainer relationships without exposing foreign/invalid/deleted/pending facts', async () => {
    const { db, repo, realmA, realmB, foreignRealm } = await fixture();
    await db.table('adHocSessions').bulkAdd([
      session('personal', 'tg:202', null),
      session('trainer-a', realmA, 'tg:101'),
      session('trainer-b', realmB, 'tg:303'),
      session('foreign', foreignRealm, 'tg:101', 'tg:404'),
      session('invalid-personal', 'tg:202', null, 'tg:202', 'tg:101'),
    ]);
    await db.table('adHocExercises').bulkAdd([
      exercise('e-personal', 'personal', 'tg:202', 'press'),
      exercise('e-trainer-a', 'trainer-a', realmA, 'press'),
      exercise('e-trainer-b', 'trainer-b', realmB, 'squat'),
      exercise('e-foreign', 'foreign', foreignRealm, 'foreign'),
      exercise('e-invalid-personal', 'invalid-personal', 'tg:202', 'bad'),
      exercise('e-wrong-realm', 'trainer-a', realmB, 'leaked'),
      exercise('e-deleted', 'trainer-a', realmA, 'deleted', date),
      exercise('e-pending', 'trainer-b', realmB, 'pending'),
    ]);
    await db.table('adHocSets').bulkAdd([
      fact('f-personal', 'personal', 'e-personal', 'tg:202'),
      fact('f-trainer-a', 'trainer-a', 'e-trainer-a', realmA),
      fact('f-trainer-b', 'trainer-b', 'e-trainer-b', realmB),
      fact('f-foreign', 'foreign', 'e-foreign', foreignRealm),
      fact('f-invalid-personal', 'invalid-personal', 'e-invalid-personal', 'tg:202'),
      fact('f-wrong-realm', 'trainer-a', 'e-wrong-realm', realmB),
      fact('f-deleted', 'trainer-a', 'e-deleted', realmA),
      fact('f-pending', 'trainer-b', 'e-pending', realmB, 'pending'),
    ]);
    const rows = await repo.listOwnExerciseFacts();
    expect(rows.map(row => row.sessionId)).toEqual(['personal', 'trainer-a', 'trainer-b']);
    expect(rows.map(row => row.key)).toEqual(['public::press', 'public::press', 'public::squat']);
    expect(rows.every(row => row.sets.length === 1 && row.sets[0].actualReps === 8)).toBe(true);
    const outsider = new AdHocWorkoutRepository(db as unknown as MezfitCloudDatabase, 'tg:404');
    expect(await outsider.listOwnExerciseFacts()).toHaveLength(1);
  });

  it('updates the personal profile live when a set finishes and removes a revoked coach relationship', async () => {
    const { db, repo, realmA } = await fixture();
    await db.table('adHocSessions').add(session('trainer-a', realmA, 'tg:101'));
    await db.table('adHocExercises').add(exercise('exercise-a', 'trainer-a', realmA, 'press'));
    await db.table('adHocSets').add(fact('set-a', 'trainer-a', 'exercise-a', realmA, 'pending'));
    const next = vi.fn();
    const error = vi.fn();
    const subscription = repo.observeOwnExerciseFacts(next, error);
    try {
      await vi.waitFor(() => {
        if (error.mock.lastCall) throw error.mock.lastCall[0];
        expect(next.mock.lastCall?.[0]).toEqual([]);
      });
      await db.table('adHocSets').update('set-a', { setStatus: 'completed', actualReps: 8 });
      await vi.waitFor(() => expect(next.mock.lastCall?.[0]).toHaveLength(1));
      await db.table('members').where('realmId').equals(realmA).delete();
      await vi.waitFor(() => expect(next.mock.lastCall?.[0]).toEqual([]));
    } finally { subscription.unsubscribe(); }
    expect(error).not.toHaveBeenCalled();
  });
});
