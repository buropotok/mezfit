import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import type { MezfitCloudDatabase } from './database';
import { AdHocWorkoutRepository } from './adhoc-workouts';
import type { AdHocSessionRow, AdHocExerciseRow, AdHocSetRow } from './adhoc-workout-types';

const databases: Dexie[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) await db.delete();
});

const now = '2026-10-30T12:00:00.000Z';
function session(id: string, realmId: string, coachUserId: string | null, athleteUserId: string,
  startedAt = now, status: 'active' | 'completed' = 'completed'): AdHocSessionRow {
  return {
    id, realmId, owner: realmId, athleteUserId, coachUserId,
    clientUserId: coachUserId ? athleteUserId : null,
    creatorUserId: coachUserId ?? athleteUserId,
    name: 'Тренировка', comment: null, programName: null, autoCreatedProgram: false,
    startedAt, completedAt: status === 'completed' ? startedAt : null,
    status, createdAt: startedAt, updatedAt: startedAt,
  };
}
function exercise(id: string, sessionId: string, realmId: string, definitionId: string, name: string,
  deletedAt: string | null = null): AdHocExerciseRow {
  return {
    id, sessionId, realmId, owner: realmId, position: 0, deletedAt, notes: null,
    exercise: { exerciseDefinitionId: definitionId, scope: 'public', name, nameEn: null,
      mediaUrl: null, trackingType: 'weight_reps' },
  };
}
function fact(id: string, sessionId: string, exerciseId: string, realmId: string,
  setStatus: 'completed' | 'skipped' | 'pending'): AdHocSetRow {
  return {
    id, sessionId, exerciseId, realmId, owner: realmId, position: 0, deletedAt: null,
    setType: null, actualReps: setStatus === 'completed' ? 8 : null, actualWeightKg: null,
    actualDurationSeconds: null, actualDistanceMeters: null, setLabel: null,
    rpe: null, comment: null, bands: [], setStatus,
  };
}
async function fixture() {
  const db = new Dexie('client-performed-' + crypto.randomUUID());
  databases.push(db);
  db.version(1).stores({
    realms: 'realmId', members: 'id, realmId, userId',
    adHocSessions: 'id, realmId, athleteUserId, status, startedAt',
    adHocExercises: 'id, realmId, sessionId, [sessionId+position]',
    adHocSets: 'id, realmId, sessionId, exerciseId, [exerciseId+position]',
  });
  const relationship = await relationshipMembership('101', '202');
  const otherCoach = await relationshipMembership('303', '202');
  const otherClient = await relationshipMembership('101', '404');
  for (const pair of [relationship, otherCoach, otherClient]) {
    await db.table('realms').add(pair.realm);
    await db.table('members').bulkAdd(pair.members);
  }
  return {
    db, realmId: relationship.realm.realmId,
    otherCoachRealmId: otherCoach.realm.realmId, otherClientRealmId: otherClient.realm.realmId,
    repo: new AdHocWorkoutRepository(db as unknown as MezfitCloudDatabase, 'tg:101'),
  };
}

describe('performed client exercises from FACT', () => {
  it('deduplicates by stable exercise identity and ignores planned, skipped, deleted and unrelated records', async () => {
    const { db, realmId, otherCoachRealmId, otherClientRealmId, repo } = await fixture();
    await db.table('adHocSessions').bulkAdd([
      session('s1', realmId, 'tg:101', 'tg:202', '2026-10-01T10:00:00.000Z'),
      session('s2', realmId, 'tg:101', 'tg:202', '2026-10-03T10:00:00.000Z', 'active'),
      session('s3', otherCoachRealmId, 'tg:303', 'tg:202'),
      session('s4', otherClientRealmId, 'tg:101', 'tg:404'),
      session('s5', 'tg:202', null, 'tg:202'),
    ]);
    await db.table('adHocExercises').bulkAdd([
      exercise('e1', 's1', realmId, 'press', 'Жим лёжа'),
      exercise('e2', 's2', realmId, 'press', 'Жим штанги лёжа'),
      exercise('e3', 's1', realmId, 'squat', 'Приседания'),
      exercise('e4', 's1', realmId, 'row', 'Тяга'),
      exercise('e5', 's1', realmId, 'lunge', 'Выпады'),
      exercise('e6', 's1', realmId, 'deadlift', 'Становая тяга', now),
      exercise('e7', 's3', otherCoachRealmId, 'other', 'У другого тренера'),
      exercise('e8', 's4', otherClientRealmId, 'other-client', 'У другого клиента'),
      exercise('e9', 's5', 'tg:202', 'personal', 'Личное'),
      exercise('e10', 's1', 'foreign', 'foreign', 'Чужая запись'),
    ]);
    await db.table('adHocSets').bulkAdd([
      fact('f1', 's1', 'e1', realmId, 'completed'),
      fact('f2', 's2', 'e2', realmId, 'completed'),
      fact('f3', 's1', 'e3', realmId, 'skipped'),
      fact('f4', 's1', 'e4', realmId, 'pending'),
      fact('f5', 's1', 'e6', realmId, 'completed'),
      fact('f6', 's3', 'e7', otherCoachRealmId, 'completed'),
      fact('f7', 's4', 'e8', otherClientRealmId, 'completed'),
      fact('f8', 's5', 'e9', 'tg:202', 'completed'),
      fact('f9', 's1', 'e10', 'foreign', 'completed'),
    ]);

    expect(await repo.listPerformedClientExercises('tg:202', realmId)).toEqual([
      { key: 'public::press', name: 'Жим штанги лёжа' },
    ]);
  });

  it('rejects history after relationship membership is revoked', async () => {
    const { db, realmId, repo } = await fixture();
    await db.table('adHocSessions').add(session('s1', realmId, 'tg:101', 'tg:202'));
    await db.table('adHocExercises').add(exercise('e1', 's1', realmId, 'press', 'Жим'));
    await db.table('adHocSets').add(fact('f1', 's1', 'e1', realmId, 'completed'));
    expect(await repo.listPerformedClientExercises('tg:202', realmId)).toHaveLength(1);
    await db.table('members').where('realmId').equals(realmId).delete();
    expect(await repo.listPerformedClientExercises('tg:202', realmId)).toEqual([]);
  });

  it('updates automatically when FACT becomes completed and stops observing after unsubscribe', async () => {
    const { db, realmId, repo } = await fixture();
    await db.table('adHocSessions').add(session('s1', realmId, 'tg:101', 'tg:202', now, 'active'));
    await db.table('adHocExercises').add(exercise('e1', 's1', realmId, 'press', 'Жим'));
    await db.table('adHocSets').add(fact('f1', 's1', 'e1', realmId, 'pending'));
    const next = vi.fn();
    const error = vi.fn();
    const subscription = repo.observePerformedClientExercises('tg:202', realmId, next, error);
    try {
      await vi.waitFor(() => expect(next).toHaveBeenCalledWith([]));
      await db.table('adHocSets').update('f1', { actualReps: 8, setStatus: 'completed' });
      await vi.waitFor(() => expect(next).toHaveBeenCalledWith([{ key: 'public::press', name: 'Жим' }]));
      expect(error).not.toHaveBeenCalled();
    } finally {
      subscription.unsubscribe();
    }
  });
});
