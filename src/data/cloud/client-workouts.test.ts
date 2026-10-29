import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import baseline from '../../../cloud/roles.json';
import grants from '../../../cloud/client-session-roles.json';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import { CLOUD_DATABASE_STORES_V12, type MezfitCloudDatabase } from './database';
import { ClientWorkoutRepository } from './client-workouts';
import { AdHocWorkoutRepository } from './adhoc-workouts';
import { STARTED_PLAN_MESSAGE } from './planned-session-policy';
import type { CloudWorkoutOccurrenceRow } from './workout-foundation-types';
import type { SetEntryFactDraft } from '../../workout/setEntryTypes';

const databases: Dexie[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const db of databases.splice(0)) await db.delete();
});
const fact: SetEntryFactDraft = { metrics: { reps: 8, weightKg: 70, durationSeconds: null, distanceMeters: null },
  setLabel: null, setType: null, rpe: null, comment: null, bands: [] };
async function fixture(installed = true) {
  const db = new Dexie('client-workouts-' + crypto.randomUUID(), { addons: [] });
  databases.push(db);
  const stores: Record<string, string | null> = {};
  for (const [table, schema] of Object.entries(CLOUD_DATABASE_STORES_V12)) stores[table] = schema?.replaceAll('@', '') ?? null;
  db.version(12).stores({ ...stores, localWorkoutSync: 'id' });
  for (const table of ['adHocSessions', 'adHocExercises', 'adHocSets'])
    db.table(table).hook('creating', key => key === undefined ? crypto.randomUUID() : undefined);
  const pair = await relationshipMembership('101', '202');
  await db.table('realms').add(pair.realm);
  await db.table('members').bulkAdd(pair.members);
  const client = baseline.roles.client.permissions;
  const overlay = grants.roles.client.permissions;
  await db.table('roles').add({ realmId: 'rlm-public', name: 'client', permissions: installed ? {
    add: [...client.add, ...overlay.add], update: { ...client.update, ...overlay.update,
      workoutOccurrences: [...client.update.workoutOccurrences, 'inactive', ...overlay.update.workoutOccurrences] },
  } : client });
  const timestamp = '2026-10-28T08:00:00.000Z';
  const row: CloudWorkoutOccurrenceRow = {
    id: 'published-workout', realmId: pair.realm.realmId, owner: pair.realm.realmId,
    athleteUserId: 'tg:202', clientUserId: 'tg:202', coachUserId: 'tg:101',
    format: 'independent', startsAtUtc: timestamp, durationMinutes: 60, status: 'scheduled', workoutSessionId: null,
    publicationStatus: 'published', createdByUserId: 'tg:101', draftAuthorUserId: 'tg:101',
    createdAt: timestamp, updatedAt: timestamp,
    plan: { name: 'Назначенная тренировка', comment: null, exercises: [{
      id: 'planned-exercise', sourceProgramExerciseId: null, position: 0, notes: null,
      exercise: { exerciseDefinitionId: '0001', scope: 'public', name: 'Жим', nameEn: null,
        mediaUrl: null, trackingType: 'weight_reps' },
      sets: [0, 1].map(position => ({ id: 'planned-set-' + position, sourceProgramSetId: null, position,
        setType: null, setLabel: null, comment: null, materialLinks: [], chatLinks: [],
        plannedReps: 12, plannedWeightKg: 50, plannedDurationSeconds: null, plannedDistanceMeters: null })),
    }] },
  };
  row.originalPlan = structuredClone(row.plan); row.publishedPlan = structuredClone(row.plan);
  await db.table('workoutOccurrences').add(row);
  const database = db as unknown as MezfitCloudDatabase;
  return { db, database, pair, row, repo: new ClientWorkoutRepository(database, 'tg:202'),
    coach: new AdHocWorkoutRepository(database, 'tg:101') };
}

async function firstSet(repo: ClientWorkoutRepository, id: string) {
  const exercise = (await repo.get(id))?.exercises[0];
  if (!exercise?.sets[0]) throw new Error('Missing fixture set');
  return { exerciseId: exercise.sessionExerciseId, setId: exercise.sets[0].sessionSetId };
}

describe('Client local-first execution foundation', () => {
  it('starts from published PLAN offline, preserves prescription, resumes, and completes the same occurrence', async () => {
    const { db, database, repo, row } = await fixture();
    const fetch = vi.fn(() => Promise.reject(new Error('offline'))); vi.stubGlobal('fetch', fetch);
    const [first, second] = await Promise.all([repo.createFromOccurrence(row.id), repo.createFromOccurrence(row.id)]);
    expect(second).toEqual(first);
    expect(await db.table('adHocSessions').count()).toBe(1);
    expect(await db.table('adHocSets').count()).toBe(2);
    const { exerciseId, setId } = await firstSet(repo, first.id);
    await repo.saveSet(first.id, setId, fact);
    await repo.addSet(first.id, exerciseId);
    expect((await repo.get(first.id))?.exercises[0].sets[0]).toMatchObject({
      plan: { reps: 12, weightKg: 50 }, fact: { metrics: fact.metrics } });
    expect((await repo.get(first.id))?.exercises[0].sets[1].fact?.metrics.reps).toBeNull();
    expect(await db.table('workoutOccurrences').get(row.id)).toEqual({ ...row,
      status: 'in_progress', workoutSessionId: first.id, updatedAt: expect.any(String) });
    await expect(repo.rename(first.id, 'Rewrite PLAN')).rejects.toThrow(STARTED_PLAN_MESSAGE);
    await expect(repo.deleteSet(first.id, setId)).rejects.toThrow(STARTED_PLAN_MESSAGE);
    await expect(repo.deleteExercise(first.id, exerciseId)).rejects.toThrow(STARTED_PLAN_MESSAGE);
    db.close(); await db.open();
    const reopened = new ClientWorkoutRepository(database, 'tg:202');
    expect((await reopened.getActive())?.id).toBe(first.id);
    expect(await reopened.list()).toEqual([{ id: first.id, name: row.plan.name, status: 'active' }]);
    await reopened.complete(first.id);
    const completed = await reopened.getRow(first.id);
    await reopened.complete(first.id);
    expect(await reopened.getRow(first.id)).toEqual(completed);
    expect(await db.table('workoutOccurrences').get(row.id)).toMatchObject({ status: 'completed',
      workoutSessionId: first.id, plan: row.plan, publishedPlan: row.publishedPlan });
    expect(await reopened.getActive()).toBeNull();
    expect(await db.table('trainingPlans').count()).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('continues subsequent Coach sets without an ownership-transfer operation', async () => {
    const { db, repo, coach, row } = await fixture();
    // Coach lifecycle guard already requires its installed role; seed the complete local slice.
    await db.table('roles').add({ realmId: 'rlm-public', name: 'coach', permissions: {
      add: ['adHocSessions', 'adHocExercises', 'adHocSets'],
      update: { workoutOccurrences: ['status', 'workoutSessionId', 'format'] },
    } });
    // Coach-led execution of this independent occurrence requires confirmed conversion.
    const started = await coach.createFromOccurrence(row.id, { asCoached: true });
    const { exerciseId, setId } = await firstSet(repo, started.id);
    await coach.saveSet(started.id, setId, fact);
    expect((await repo.getActive())?.id).toBe(started.id);
    await expect(repo.createQuick()).rejects.toThrow('ADHOC_ACTIVE_SESSION_EXISTS');
    const next = (await repo.get(started.id))?.exercises[0].sets[1];
    if (!next) throw new Error('Missing subsequent set');
    const before = await db.table('adHocSets').get(setId);
    await repo.saveSet(started.id, next.sessionSetId, { ...fact, metrics: { ...fact.metrics, reps: 6 } });
    expect(await db.table('adHocSets').get(setId)).toEqual(before);
    expect((await coach.get(started.id))?.exercises[0].sets[1].fact?.metrics.reps).toBe(6);
    const frozen = await coach.getRow(started.id);
    await repo.addSet(started.id, exerciseId);
    const extra = (await repo.get(started.id))?.exercises[0].sets[2];
    if (!extra) throw new Error('Missing FACT-only set');
    await repo.deleteSet(started.id, extra.sessionSetId);
    await repo.complete(started.id);
    expect((await repo.getRow(started.id))?.occurrencePlan).toEqual(frozen?.occurrencePlan);
    expect((await coach.getRow(started.id))?.status).toBe('completed');
  });

  it('creates a personal own workout without creating or altering a program', async () => {
    const { db, repo } = await fixture(false);
    const { id } = await repo.createQuick();
    expect(await repo.getRow(id)).toMatchObject({ realmId: 'tg:202', owner: 'tg:202',
      athleteUserId: 'tg:202', coachUserId: null, clientUserId: null });
    await repo.rename(id, 'Своя'); await repo.comment(id, 'Заметка'); await repo.complete(id);
    expect(await db.table('trainingPlans').count()).toBe(0);
    await expect(repo.createForAthlete('tg:202')).rejects.toThrow('CLIENT_SOURCE_PLAN_FORBIDDEN');
  });

  it('rejects uninstalled Client ACL and rolls back all children when insertion fails', async () => {
    const { db, row, repo } = await fixture(false);
    await expect(repo.createFromOccurrence(row.id)).rejects.toThrow('CLIENT_EXECUTION_ACL_REQUIRED');
    expect(await db.table('adHocSessions').count()).toBe(0);
    expect(await db.table('workoutOccurrences').get(row.id)).toEqual(row);
    const full = await fixture();
    let count = 0;
    full.db.table('adHocSets').hook('creating', () => { if (++count === 2) throw new Error('disk unavailable'); });
    await expect(full.repo.createFromOccurrence(full.row.id)).rejects.toThrow('disk unavailable');
    for (const table of ['adHocSessions', 'adHocExercises', 'adHocSets', 'localWorkoutSync'])
      expect(await full.db.table(table).count()).toBe(0);
    expect(await full.db.table('workoutOccurrences').get(full.row.id)).toEqual(full.row);
  });

  it.each(['draft', 'cancelled', 'inactive', 'foreign', 'revoked', 'event'])('denies %s occurrence before Start', async kind => {
    const { db, database, pair, row, repo } = await fixture();
    if (kind === 'draft') await db.table('workoutOccurrences').update(row.id, { publicationStatus: 'draft' });
    if (kind === 'cancelled') await db.table('workoutOccurrences').update(row.id, { cancelledAt: row.startsAtUtc });
    if (kind === 'inactive') await db.table('workoutOccurrences').update(row.id, { inactive: true });
    if (kind === 'foreign') await expect(new ClientWorkoutRepository(database, 'tg:303')
      .createFromOccurrence(row.id)).rejects.toThrow('PLANNED_WORKOUT_NOT_FOUND');
    else {
      if (kind === 'revoked') await db.table('members').delete(pair.members[1].id);
      if (kind === 'event') await db.table('workoutOccurrences').update(row.id, { entryKind: 'personal_event' });
      await expect(repo.createFromOccurrence(row.id)).rejects.toThrow('PLANNED_WORKOUT_NOT_FOUND');
    }
    expect(await db.table('adHocSessions').count()).toBe(0);
  });

  it('rejects foreign sets, malformed FACT, revoked membership and missing grants without partial writes', async () => {
    const { db, row, repo, pair } = await fixture();
    const { id } = await repo.createFromOccurrence(row.id);
    const { setId } = await firstSet(repo, id);
    const before = await db.table('adHocSets').get(setId);
    await expect(repo.saveSet(id, 'foreign', fact)).rejects.toThrow('ADHOC_SET_NOT_FOUND');
    await expect(repo.saveSet(id, setId, { ...fact, metrics: { ...fact.metrics, reps: -1 } }))
      .rejects.toThrow('ADHOC_INVALID_FACT');
    await db.table('roles').update(['rlm-public', 'client'], { permissions: baseline.roles.client.permissions });
    await expect(repo.complete(id)).rejects.toThrow('CLIENT_EXECUTION_ACL_REQUIRED');
    expect((await repo.getRow(id))?.status).toBe('active');
    expect(await db.table('workoutOccurrences').get(row.id)).toMatchObject({ status: 'in_progress' });
    await db.table('members').delete(pair.members[1].id);
    await expect(repo.saveSet(id, setId, fact)).rejects.toThrow('ADHOC_SESSION_NOT_FOUND');
    expect(await repo.getActive()).toBeNull();
    expect(await db.table('adHocSets').get(setId)).toEqual(before);
  });
});
