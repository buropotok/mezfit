// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import dexieCloud from 'dexie-cloud-addon';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import { CLOUD_DATABASE_STORES_V12, type MezfitCloudDatabase } from './database';
import { AdHocWorkoutRepository } from './adhoc-workouts';
import { isAdHocSessionRow } from './adhoc-workout-types';

const databases: Dexie[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) await db.delete();
  vi.unstubAllGlobals();
});

async function fixture() {
  const fetch = vi.fn(() => Promise.reject(new Error('Network must not be used')));
  vi.stubGlobal('fetch', fetch);
  const db = new Dexie('adhoc-addon-' + crypto.randomUUID(), { addons: [dexieCloud] });
  databases.push(db);
  db.version(12).stores({ ...CLOUD_DATABASE_STORES_V12, localProgramSync: 'id' });
  db.cloud.configure({ databaseUrl: '', requireAuth: false, disableEagerSync: true,
    disableWebSocket: true, tryUseServiceWorker: false,
    unsyncedTables: ['localProgramSync', 'localWorkoutOccurrenceDrafts'] });
  const pair = await relationshipMembership('101', '202');
  await db.open();
  // Same contract as workout-occurrence-addon.test.ts: Worker-provisioned
  // ownerless membership must bypass local implicit-owner rewriting.
  await new Promise<void>((resolve, reject) => {
    const tx = db.backendDB().transaction(['realms', 'members'], 'readwrite');
    tx.objectStore('realms').put(pair.realm);
    for (const member of pair.members) tx.objectStore('members').put(member);
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
  });
  const database = db as MezfitCloudDatabase;
  return { db, database, pair, fetch, repo: new AdHocWorkoutRepository(database, 'tg:101') };
}

describe('ad-hoc sessions with pinned Dexie Cloud Addon 4.4.15', () => {
  it.each(['personal', 'client'] as const)('preserves %s programme provenance and observed execution through edits and reopen', async target => {
    const { db, database, pair, fetch, repo } = await fixture();
    const athlete = target === 'personal' ? 'tg:101' : 'tg:202';
    const realmId = target === 'personal' ? 'tg:101' : pair.realm.realmId;
    const timestamp = '2026-10-27T00:00:00.000Z';
    // Seed an already synchronized PLAN with explicit author ownership. The
    // local-only Addon is unauthenticated; null owners would become unauthorized.
    // Keep Addon ID generation and all execution middleware enabled.
    const programId = await database.trainingPlans.add({ realmId, owner: 'tg:101',
      athleteUserId: athlete, coachUserId: target === 'client' ? 'tg:101' : null,
      clientUserId: target === 'client' ? athlete : null, name: 'Программа', position: 0,
      status: 'draft', startedAt: null, finishedAt: null, createdAt: timestamp, updatedAt: timestamp });
    const phaseId = await database.programPhases.add({ realmId, owner: 'tg:101', trainingPlanId: programId,
      name: 'Фаза', status: 'draft', position: 0, plannedStartDate: null, plannedEndDate: null });
    const dayId = await database.programDays.add({ realmId, owner: 'tg:101', programPhaseId: phaseId,
      name: 'День', status: 'active', position: 0 });
    const exerciseId = await database.programExercises.add({ realmId, owner: 'tg:101', programDayId: dayId,
      position: 0, status: 'active', notes: 'Do not copy', exercise: {
        exerciseDefinitionId: '0001', scope: 'public', name: 'Жим', nameEn: null,
        mediaUrl: null, trackingType: 'weight_reps',
      } });
    await database.programSets.add({ realmId, owner: 'tg:101', programExerciseId: exerciseId,
      position: 0, status: 'active', setType: 'cluster', plannedReps: 12, plannedWeightKg: 50,
      plannedDurationSeconds: null, plannedDistanceMeters: null });
    const created = await repo.createForAthlete(athlete, programId, dayId);
    expect(db.cloud.schema?.adHocSessions.markedForSync).toBe(true);
    expect(isAdHocSessionRow(await database.adHocSessions.get(created.id))).toBe(true);
    expect(await repo.getRow(created.id)).toMatchObject({ programId, dayId, owner: realmId, realmId });
    const next = vi.fn(), error = vi.fn();
    const subscription = repo.observe(created.id, next, error);
    try {
      await vi.waitFor(() => expect(next.mock.lastCall?.[0]?.sessionId).toBe(created.id));
      const initial = await repo.get(created.id);
      const set = initial?.exercises[0]?.sets[0];
      if (!set) throw new Error('Missing execution set');
      expect(set).toMatchObject({ plan: null, previous: null, setType: 'cluster' });
      await repo.saveSet(created.id, set.sessionSetId, { metrics: { reps: 8, weightKg: 70,
        durationSeconds: null, distanceMeters: null }, setLabel: null, setType: 'cluster',
        rpe: null, comment: null, bands: [] });
      await vi.waitFor(() => expect(next.mock.lastCall?.[0]?.exercises[0]?.sets[0]?.fact?.metrics.reps).toBe(8));
      await repo.rename(created.id, 'Изменённая');
      await vi.waitFor(() => expect(next.mock.lastCall?.[1]?.name).toBe('Изменённая'));
      expect(next.mock.calls.every(call => call[0] !== null)).toBe(true);
      expect(error).not.toHaveBeenCalled();
    } finally { subscription.unsubscribe(); }
    db.close(); await db.open();
    const reopened = new AdHocWorkoutRepository(database, 'tg:101');
    expect(await reopened.getRow(created.id)).toMatchObject({ programId, dayId, status: 'active' });
    expect((await reopened.get(created.id))?.exercises[0]?.sets[0]?.fact?.metrics.reps).toBe(8);
    await expect(reopened.createQuick()).rejects.toThrow('ADHOC_ACTIVE_SESSION_EXISTS');
    await reopened.complete(created.id);
    const quick = await reopened.createQuick();
    expect(await reopened.getRow(quick.id)).not.toHaveProperty('programId');
    expect((await reopened.getActive())?.id).toBe(quick.id);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('creates and completes the default personal programme without losing the pending template choice', async () => {
    const { database, repo, fetch } = await fixture();
    const created = await repo.createForAthlete('tg:101');
    expect(created.createdProgram).toBe(true);
    const row = await repo.getRow(created.id);
    expect(row?.programId).toBeTruthy();
    expect(row?.dayId).toBeTruthy();
    expect(isAdHocSessionRow(await database.adHocSessions.get(created.id))).toBe(true);
    await repo.complete(created.id);
    expect(await repo.getActive()).toBeNull();
    const quick = await repo.createQuick();
    expect(await repo.list()).toEqual(expect.arrayContaining([
      { id: created.id, name: 'Тренировка', status: 'completed' },
      { id: quick.id, name: 'Тренировка', status: 'active' },
    ]));
    await repo.resolveTemplate(created.id, false);
    expect((await repo.getRow(created.id))?.templateSaveDecision).toBe('declined');
    expect(fetch).not.toHaveBeenCalled();
  });
});
