import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import { AdHocWorkoutRepository } from './adhoc-workouts';
import type { AdHocSessionRow, AdHocExerciseRow, AdHocSetRow } from './adhoc-workout-types';
import type { MezfitCloudDatabase } from './database';

const databases: Dexie[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) await db.delete();
});
const date = '2026-10-30T12:00:00.000Z';
function session(id: string, realmId: string, coach: string, athlete: string): AdHocSessionRow {
  return {
    id, realmId, owner: realmId, athleteUserId: athlete,
    coachUserId: coach, clientUserId: athlete, creatorUserId: coach,
    name: 'Тренировка', comment: null, programName: null, autoCreatedProgram: false,
    startedAt: date, completedAt: date, status: 'completed', createdAt: date, updatedAt: date,
  };
}
function exercise(id: string, sessionId: string, realmId: string): AdHocExerciseRow {
  return {
    id, sessionId, realmId, owner: realmId, position: 0, notes: null, deletedAt: null,
    exercise: {
      exerciseDefinitionId: 'press', scope: 'public', name: 'Жим', nameEn: null,
      mediaUrl: '/own-media/press.gif', trackingType: 'weight_reps',
    },
  };
}
function set(id: string, sessionId: string, exerciseId: string, realmId: string,
  status: 'pending' | 'completed'): AdHocSetRow {
  return {
    id, sessionId, exerciseId, realmId, owner: realmId,
    position: 0, deletedAt: null, setType: null,
    actualReps: status === 'completed' ? 8 : null,
    actualWeightKg: status === 'completed' ? 65 : null,
    actualDurationSeconds: null, actualDistanceMeters: null,
    setLabel: null, rpe: null, comment: null, bands: [], setStatus: status,
  };
}
async function fixture() {
  const db = new Dexie('client-exercise-metrics-' + crypto.randomUUID(), { addons: [] });
  databases.push(db);
  db.version(1).stores({
    realms: 'realmId', members: 'id, realmId, userId',
    adHocSessions: 'id, realmId, athleteUserId, startedAt',
    adHocExercises: 'id, realmId, sessionId',
    adHocSets: 'id, realmId, sessionId, exerciseId',
    publicExerciseDefinitions: 'id, realmId',
  });
  const pair = await relationshipMembership('101', '202');
  const foreign = await relationshipMembership('303', '202');
  for (const relation of [pair, foreign]) {
    await db.table('realms').add(relation.realm);
    await db.table('members').bulkAdd(relation.members);
  }
  const repo = new AdHocWorkoutRepository(db as unknown as MezfitCloudDatabase, 'tg:101');
  return { db, repo, realm: pair.realm.realmId, otherRealm: foreign.realm.realmId };
}

describe('read-only exercise FACT analytics projection', () => {
  it('returns only completed sets for the authorized relationship with snapshot media', async () => {
    const { db, repo, realm, otherRealm } = await fixture();
    await db.table('adHocSessions').bulkAdd([
      session('s1', realm, 'tg:101', 'tg:202'),
      session('s2', otherRealm, 'tg:303', 'tg:202'),
    ]);
    await db.table('adHocExercises').bulkAdd([
      exercise('e1', 's1', realm), exercise('e2', 's2', otherRealm),
    ]);
    await db.table('adHocSets').bulkAdd([
      set('f1', 's1', 'e1', realm, 'completed'),
      set('f2', 's1', 'e1', realm, 'pending'),
      set('f3', 's2', 'e2', otherRealm, 'completed'),
    ]);
    expect(await repo.listClientExerciseFacts('tg:202', realm)).toEqual([{
      key: 'public::press', name: 'Жим', category: 'other',
      mediaUrl: '/own-media/press.gif', trackingType: 'weight_reps',
      sessionId: 's1', sessionExerciseId: 'e1', startedAt: date,
      sets: [{ actualReps: 8, actualWeightKg: 65,
        actualDurationSeconds: null, actualDistanceMeters: null }],
    }]);
    await db.table('members').where('realmId').equals(realm).delete();
    expect(await repo.listClientExerciseFacts('tg:202', realm)).toEqual([]);
  });

  it('reacts to completion and removes revoked results on liveQuery changes', async () => {
    const { db, repo, realm } = await fixture();
    await db.table('adHocSessions').add(session('s1', realm, 'tg:101', 'tg:202'));
    await db.table('adHocExercises').add(exercise('e1', 's1', realm));
    await db.table('adHocSets').add(set('f1', 's1', 'e1', realm, 'pending'));
    const next = vi.fn();
    const error = vi.fn();
    const observer = repo.observeClientExerciseFacts('tg:202', realm, next, error);
    try {
      await vi.waitFor(() => {
        if (error.mock.lastCall) throw error.mock.lastCall[0];
        expect(next.mock.lastCall?.[0]).toEqual([]);
      });
      await db.table('adHocSets').update('f1', {
        setStatus: 'completed', actualReps: 8, actualWeightKg: 65,
      });
      await vi.waitFor(() => {
        if (error.mock.lastCall) throw error.mock.lastCall[0];
        expect(next.mock.lastCall?.[0]).toHaveLength(1);
      });
      await db.table('members').where('realmId').equals(realm).delete();
      await vi.waitFor(() => expect(next.mock.lastCall?.[0]).toEqual([]));
    } finally { observer.unsubscribe(); }
    expect(error).not.toHaveBeenCalled();
  });
});
