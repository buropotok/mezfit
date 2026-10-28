// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import dexieCloud from 'dexie-cloud-addon';
import { afterEach, describe, expect, it, vi } from 'vitest';
import baseline from '../../../cloud/roles.json';
import grants from '../../../cloud/client-session-roles.json';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import { CLOUD_DATABASE_STORES_V12, type MezfitCloudDatabase } from './database';
import { ClientWorkoutRepository } from './client-workouts';
import type { CloudWorkoutOccurrenceRow } from './workout-foundation-types';

const databases: Dexie[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) await db.delete();
  vi.unstubAllGlobals();
});

describe('Client execution with pinned Dexie Cloud Addon', () => {
  it('generates synchronized sentinel-owned execution locally, observes FACT and resumes after reopening', async () => {
    const fetch = vi.fn(() => Promise.reject(new Error('offline'))); vi.stubGlobal('fetch', fetch);
    const db = new Dexie('client-addon-' + crypto.randomUUID(), { addons: [dexieCloud] });
    databases.push(db);
    db.version(12).stores({ ...CLOUD_DATABASE_STORES_V12, localProgramSync: 'id', localWorkoutSync: 'id' });
    db.cloud.configure({ databaseUrl: '', requireAuth: false, disableEagerSync: true,
      disableWebSocket: true, tryUseServiceWorker: false,
      unsyncedTables: ['localProgramSync', 'localWorkoutSync', 'localWorkoutOccurrenceDrafts'] });
    const pair = await relationshipMembership('101', '202');
    const timestamp = '2026-10-28T08:00:00.000Z';
    const row: Omit<CloudWorkoutOccurrenceRow, 'id'> = {
      realmId: pair.realm.realmId, owner: pair.realm.realmId,
      athleteUserId: 'tg:202', clientUserId: 'tg:202', coachUserId: 'tg:101', format: 'independent',
      startsAtUtc: timestamp, durationMinutes: 60, status: 'scheduled', workoutSessionId: null,
      publicationStatus: 'published', createdByUserId: 'tg:101', createdAt: timestamp, updatedAt: timestamp,
      plan: { name: 'Тренировка', comment: null, exercises: [{ id: 'exercise', sourceProgramExerciseId: null,
        position: 0, notes: null, exercise: { exerciseDefinitionId: '0001', scope: 'public', name: 'Жим',
          nameEn: null, mediaUrl: null, trackingType: 'weight_reps' },
        sets: [{ id: 'set', sourceProgramSetId: null, position: 0, setType: null, setLabel: null,
          comment: null, materialLinks: [], chatLinks: [], plannedReps: 12, plannedWeightKg: 50,
          plannedDurationSeconds: null, plannedDistanceMeters: null }] }] },
    };
    await db.open();
    // Seed synchronized infrastructure without Addon's unauthenticated owner rewriting;
    // product writes below retain the actual Addon middleware and generated IDs.
    await new Promise<void>((resolve, reject) => {
      const tx = db.backendDB().transaction(['realms', 'members', 'roles'], 'readwrite');
      tx.objectStore('realms').put(pair.realm);
      for (const member of pair.members) tx.objectStore('members').put(member);
      tx.objectStore('roles').put({ realmId: 'rlm-public', name: 'client', permissions: {
        add: [...baseline.roles.client.permissions.add, ...grants.roles.client.permissions.add],
        update: { ...baseline.roles.client.permissions.update, ...grants.roles.client.permissions.update,
          workoutOccurrences: [...baseline.roles.client.permissions.update.workoutOccurrences, 'inactive',
            ...grants.roles.client.permissions.update.workoutOccurrences] },
      } });
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    });
    const database = db as MezfitCloudDatabase;
    const occurrenceId = await database.workoutOccurrences.add(row);
    const repo = new ClientWorkoutRepository(database, 'tg:202');
    const { id } = await repo.createFromOccurrence(occurrenceId);
    expect(db.cloud.schema?.adHocSessions.markedForSync).toBe(true);
    expect(await repo.getRow(id)).toMatchObject({ realmId: row.realmId, owner: row.realmId, occurrencePlan: row.plan });
    const session = await repo.get(id);
    const setId = session?.exercises[0]?.sets[0]?.sessionSetId;
    if (!setId) throw new Error('Missing generated set');
    const next = vi.fn(), error = vi.fn();
    const subscription = repo.observe(id, next, error);
    try {
      await repo.saveSet(id, setId, { metrics: { reps: 8, weightKg: 70, durationSeconds: null, distanceMeters: null },
        setType: null, setLabel: null, rpe: null, comment: null, bands: [] });
      await vi.waitFor(() => expect(next.mock.lastCall?.[0]?.exercises[0]?.sets[0]?.fact?.metrics.reps).toBe(8));
      expect(error).not.toHaveBeenCalled();
    } finally { subscription.unsubscribe(); }
    db.close(); await db.open();
    const reopened = new ClientWorkoutRepository(database, 'tg:202');
    expect((await reopened.getActive())?.id).toBe(id);
    await reopened.complete(id);
    expect(await database.workoutOccurrences.get(occurrenceId)).toMatchObject({ status: 'completed', workoutSessionId: id, plan: row.plan });
    expect((await reopened.get(id))?.exercises[0].sets[0]).toMatchObject({ plan: { reps: 12, weightKg: 50 },
      fact: { metrics: { reps: 8, weightKg: 70 } } });
    expect(fetch).not.toHaveBeenCalled();
  });
});
