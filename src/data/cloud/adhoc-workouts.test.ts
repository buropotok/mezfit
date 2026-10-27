import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import roles from '../../../cloud/roles.json';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import { CLOUD_DATABASE_STORES_V12, CLOUD_DATABASE_VERSION, type MezfitCloudDatabase } from './database';
import { AdHocWorkoutRepository, type AdHocSessionRow, type AdHocExerciseRow, type AdHocSetRow } from './adhoc-workouts';
import type { PublicExerciseRow } from '../exercises/publicExerciseTypes';
import type { SetEntryFactDraft } from '../../workout/setEntryTypes';

const databases: Dexie[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const db of databases.splice(0)) await db.delete();
});
const sha = 'a'.repeat(64);
function definition(id: string): PublicExerciseRow {
  return { id, realmId: 'rlm-public', owner: null, sourceSha256: sha,
    name: 'Press', name_ru: 'Жим', name_en: 'Press', category: 'chest',
    subcategory: 'chest', subcategory_ru: 'Грудь', movement_type: 'resistance', tracking_type: 'weight_reps',
    muscles: { primary: [], secondary: [], stabilizers: [], emphasis: [] }, mobility_targets: [],
    equipment: 'barbell', body_part: 'chest', target: 'chest', muscle_group: 'chest', secondary_muscles: [],
    media_id: id, image: '', gif_url: '', attribution: '', created_at: '', instructions: { ru: '', en: '' },
    instruction_steps: { ru: [], en: [] }, source_consistency_issue: null,
    anatomy_evidence: { classification_family: '', basis: '', external_individual_match: false } };
}
async function fixture() {
  const db = new Dexie('adhoc-' + crypto.randomUUID(), { addons: [] });
  databases.push(db);
  // Real IndexedDB transactions/liveQuery. Only Addon's generated keys are emulated.
  const stores: Record<string, string | null> = {};
  for (const [table, schema] of Object.entries(CLOUD_DATABASE_STORES_V12))
    stores[table] = schema?.replaceAll('@', '') ?? null;
  db.version(12).stores({ ...stores, localProgramSync: 'id' });
  for (const table of ['adHocSessions', 'adHocExercises', 'adHocSets', 'trainingPlans',
    'programPhases', 'programDays', 'programExercises', 'programSets']) {
    db.table(table).hook('creating', key => key === undefined ? crypto.randomUUID() : undefined);
  }
  const pair = await relationshipMembership('101', '202');
  await db.table('realms').add(pair.realm);
  await db.table('members').bulkAdd(pair.members);
  await db.table('roles').add({ realmId: 'rlm-public', name: 'coach', ...roles.roles.coach });
  await db.table('publicExerciseDefinitions').bulkAdd([definition('0001'), definition('0002')]);
  await db.table('publicExerciseCatalogues').add({ id: 'mezfit:exercise-catalogue', realmId: 'rlm-public',
    owner: null, sourceSha256: sha, schemaVersion: '2.0.0', catalogue: 'mezfit.exercise_catalog.ru_anatomy',
    exerciseCount: 1324, taxonomyCount: 69, subcategoryLabelsRu: {}, movementFamilyReferences: {},
    metadata: {}, publishedAt: '2026-10-27' });
  const database = db as unknown as MezfitCloudDatabase;
  return { db, pair, repo: new AdHocWorkoutRepository(database, 'tg:101'),
    client: new AdHocWorkoutRepository(database, 'tg:202'),
    stranger: new AdHocWorkoutRepository(database, 'tg:303'), database };
}
const fact: SetEntryFactDraft = { metrics: { reps: 8, weightKg: 70, durationSeconds: null, distanceMeters: null },
  setLabel: 'hard', setType: 'cluster', rpe: 8, comment: 'Тяжело', bands: ['red'] };
const sessionTable = (db: Dexie) => db.table<AdHocSessionRow, string>('adHocSessions');
const exerciseTable = (db: Dexie) => db.table<AdHocExerciseRow, string>('adHocExercises');
const setTable = (db: Dexie) => db.table<AdHocSetRow, string>('adHocSets');

async function oneExercise(repo: AdHocWorkoutRepository, id: string) {
  await repo.addExercises(id, ['0001']);
  const session = await repo.get(id);
  if (!session?.exercises[0]?.sets[0]) throw new Error('Missing fixture exercise/set');
  return { exerciseId: session.exercises[0].sessionExerciseId, setId: session.exercises[0].sets[0].sessionSetId };
}

describe('local ad-hoc execution', () => {
  it('registers separate synchronized v12 tables without altering scheduled session stores', () => {
    expect(CLOUD_DATABASE_VERSION).toBe(12);
    expect(CLOUD_DATABASE_STORES_V12.adHocSessions).toBe('@id, realmId, athleteUserId, status, startedAt');
    expect(CLOUD_DATABASE_STORES_V12.adHocExercises).toBe('@id, realmId, sessionId, [sessionId+position]');
    expect(CLOUD_DATABASE_STORES_V12.adHocSets).toBe('@id, realmId, sessionId, exerciseId, [exerciseId+position]');
    expect(CLOUD_DATABASE_STORES_V12.sessionSets).toContain('sessionExerciseId');
  });
  it('quick start creates a blank personal session without programs, both before and after programs exist', async () => {
    const { db, repo } = await fixture();
    const listing = vi.spyOn(repo, 'listPrograms');
    const creating = vi.spyOn(repo.programs, 'createPersonal');
    const first = await repo.createQuick();
    expect(first.createdProgram).toBe(false);
    expect(await db.table('trainingPlans').count()).toBe(0);
    expect(await db.table('programDays').count()).toBe(0);
    expect(await repo.getRow(first.id)).toMatchObject({ autoCreatedProgram: false, programName: null,
      realmId: 'tg:101', owner: 'tg:101' });
    expect((await repo.get(first.id))?.exercises).toEqual([]);
    await repo.programs.createPersonal('Уже существует');
    creating.mockClear();
    await repo.complete(first.id);
    const second = await repo.createQuick();
    expect(second.createdProgram).toBe(false);
    expect(await db.table('trainingPlans').count()).toBe(1);
    expect(await repo.getRow(second.id)).not.toHaveProperty('programId');
    expect(await repo.getRow(second.id)).not.toHaveProperty('dayId');
    expect(listing).not.toHaveBeenCalled();
    expect(creating).not.toHaveBeenCalled();
    await repo.complete(first.id);
    expect((await repo.getRow(first.id))?.templateSaveDecision).toBeUndefined();
  });
  it('starts, edits and completes offline and resumes a pending template question after reopening', async () => {
    const { db, repo, database } = await fixture();
    const fetch = vi.fn(() => Promise.reject(new Error('offline')));
    vi.stubGlobal('fetch', fetch);
    const next = vi.fn(), error = vi.fn();
    const subscription = repo.observeOpen(next, error);
    try {
      const created = await repo.createForAthlete('tg:101');
      expect(created.createdProgram).toBe(true);
      expect(await db.table('trainingPlans').count()).toBe(1);
      expect(await db.table('programPhases').count()).toBe(1);
      expect(await db.table('programDays').count()).toBe(1);
      const { exerciseId, setId } = await oneExercise(repo, created.id);
      await repo.saveSet(created.id, setId, fact);
      await repo.addSet(created.id, exerciseId);
      const sets = (await repo.get(created.id))?.exercises[0].sets;
      expect(sets?.[1]).toMatchObject({ status: 'pending', setType: 'cluster',
        plan: null, previous: null, fact: { metrics: fact.metrics } });
      expect(sets?.[1].fact?.comment).toBeNull();
      await repo.rename(created.id, 'Вечерняя');
      await repo.comment(created.id, 'Самочувствие хорошее');
      await repo.complete(created.id);
      const completedAt = (await repo.getRow(created.id))?.completedAt;
      await repo.complete(created.id);
      expect((await repo.getRow(created.id))?.completedAt).toBe(completedAt);
      await vi.waitFor(() => expect(next.mock.lastCall?.[0]).toEqual([{ id: created.id, name: 'Вечерняя', status: 'completed' }]));
      db.close(); await db.open();
      const reopened = new AdHocWorkoutRepository(database, 'tg:101');
      expect(await reopened.getRow(created.id)).toMatchObject({ autoCreatedProgram: true,
        templateSaveDecision: 'pending', comment: 'Самочувствие хорошее' });
      await reopened.resolveTemplate(created.id, false);
      await reopened.complete(created.id);
      expect(await reopened.list()).toEqual([]);
      expect((await reopened.getRow(created.id))?.templateSaveDecision).toBe('declined');
      expect(await db.table('programExercises').count()).toBe(0);
      expect(await db.table('workoutSessions').count()).toBe(0);
      expect(await db.table('sessionSets').count()).toBe(0);
      expect(fetch).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally { subscription.unsubscribe(); }
  });
  it('requires selection if any schedulable program exists, and concurrent athlete starts create one default graph', async () => {
    const { db, repo } = await fixture();
    const result = await Promise.allSettled([repo.createForAthlete('tg:101'), repo.createForAthlete('tg:101')]);
    expect(result.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    expect(result.filter(row => row.status === 'rejected')).toHaveLength(1);
    const active = await repo.getActive();
    if (!active) throw new Error('Missing session');
    await expect(repo.createForAthlete('tg:101')).rejects.toThrow('ADHOC_ACTIVE_SESSION_EXISTS');
    await repo.complete(active.id);
    await expect(repo.createForAthlete('tg:101')).rejects.toThrow('ADHOC_PROGRAM_SELECTION_REQUIRED');
    expect(await sessionTable(db).count()).toBe(1);
    expect(await db.table('trainingPlans').count()).toBe(1);
    expect(await repo.listPrograms('tg:101')).toHaveLength(1);
  });
  it('rolls back the entire default program graph if session insertion fails', async () => {
    const { db, repo } = await fixture();
    const fail = () => { throw new Error('insert failed'); };
    sessionTable(db).hook('creating', fail);
    await expect(repo.createForAthlete('tg:101')).rejects.toThrow('insert failed');
    for (const table of ['trainingPlans', 'programPhases', 'programDays', 'localProgramSync', 'adHocSessions'])
      expect(await db.table(table).count()).toBe(0);
  });
  it('atomically rejects unavailable exercises and unknown tracking without silently using weight/reps', async () => {
    const { db, repo } = await fixture();
    const { id } = await repo.createForAthlete('tg:101');
    await expect(repo.addExercises(id, ['0001', '9999'])).rejects.toThrow();
    expect(await exerciseTable(db).count()).toBe(0);
    expect(await setTable(db).count()).toBe(0);
    await db.table('publicExerciseDefinitions').update('0001', { tracking_type: undefined });
    await expect(repo.addExercises(id, ['0001'])).rejects.toThrow('ADHOC_EXERCISE_TRACKING_REQUIRED');
    expect(await exerciseTable(db).count()).toBe(0);
  });
  it('snapshots selected day structure/types and excludes numeric plans, notes and prior results', async () => {
    const { db, repo } = await fixture();
    const programId = await repo.programs.createPersonal('Силовая');
    const details = await repo.programs.details(programId);
    if (!details?.phases[0]) throw new Error('Missing phase');
    const dayId = await repo.programs.createDay(programId, details.phases[0].id, 'День А');
    await repo.programs.addDayExercises(programId, dayId, ['0001']);
    const templateExercise = (await db.table('programExercises').toArray())[0];
    await repo.programs.addExerciseSet(programId, dayId, templateExercise.id);
    const templateSet = (await db.table('programSets').toArray())[0];
    await db.table('programSets').update(templateSet.id, { plannedReps: 12, plannedWeightKg: 50,
      plannedDurationSeconds: 60, plannedDistanceMeters: 100, setType: 'rest_pause', comment: 'source only' });
    const created = await repo.createForAthlete('tg:101', programId, dayId);
    expect(created.createdProgram).toBe(false);
    const session = await repo.get(created.id);
    expect(session?.program).toEqual({ id: programId, name: 'Силовая' });
    expect(session?.day?.name).toBe('День А');
    expect(session?.exercises[0].exercise.scope).toBe('global');
    expect(session?.exercises[0].mediaUrl).toBeDefined();
    expect(session?.creator).toBeUndefined();
    expect(session?.exercises[0].sets[0]).toMatchObject({ setType: 'rest_pause', plan: null, previous: null,
      fact: { metrics: { reps: null, weightKg: null, durationSeconds: null, distanceMeters: null }, comment: null } });
    await db.table('programExercises').update(templateExercise.id, { status: 'deprecated' });
    await db.table('publicExerciseDefinitions').delete('0001');
    expect((await repo.get(created.id))?.exercises[0].exercise.tracking_type).toBe('weight_reps');
    await repo.complete(created.id);
    expect((await repo.getRow(created.id))?.templateSaveDecision).toBeUndefined();
    expect(await repo.list()).toEqual([]);
  });
  it('uses immutable private snapshot tracking when its catalogue row is no longer local, and rejects unknown tracking atomically', async () => {
    const { db, repo } = await fixture();
    const programId = await repo.programs.createPersonal('Программа');
    const phase = (await repo.programs.details(programId))?.phases[0];
    if (!phase) throw new Error('Missing phase');
    const dayId = await repo.programs.createDay(programId, phase.id, 'День');
    const customId = 'custom:' + crypto.randomUUID();
    const custom = { ...definition('0001'), id: customId, realmId: 'tg:101', owner: 'tg:101',
      sourceSha256: 'coach-custom', updatedAt: new Date().toISOString(), archivedAt: null };
    await db.table('coachExerciseDefinitions').put(custom);
    await repo.programs.addDayExercises(programId, dayId, [customId]);
    const source = (await db.table('programExercises').toArray())[0];
    await repo.programs.addExerciseSet(programId, dayId, source.id);
    await db.table('programExercises').update(source.id, { exercise: { ...source.exercise,
      catalogueDefinition: { ...source.exercise.catalogueDefinition, tracking_type: 'time_weight' } } });
    await db.table('coachExerciseDefinitions').delete(customId);
    const created = await repo.createForAthlete('tg:101', programId, dayId);
    expect((await repo.get(created.id))?.exercises[0].exercise).toMatchObject({ scope: 'coach', tracking_type: 'time_weight' });
    await repo.programs.addDayExercises(programId, dayId, ['0002']);
    await db.table('publicExerciseDefinitions').delete('0002');
    await repo.complete(created.id);
    await expect(repo.createForAthlete('tg:101', programId, dayId)).rejects.toThrow('ADHOC_EXERCISE_TRACKING_REQUIRED');
    expect(await sessionTable(db).count()).toBe(1);
    expect(await exerciseTable(db).count()).toBe(1);
    expect(await setTable(db).count()).toBe(1);
  });
  it('enforces program/day ancestry and athlete selection locally', async () => {
    const { db, repo } = await fixture();
    const first = await repo.createForAthlete('tg:101');
    const row = await repo.getRow(first.id);
    const otherProgram = await repo.programs.createPersonal('Другая');
    await repo.complete(first.id);
    await expect(repo.createForAthlete('tg:101', otherProgram, row?.dayId)).rejects.toThrow('ADHOC_DAY_NOT_FOUND');
    await expect(repo.createForAthlete('tg:202', row?.programId, row?.dayId)).rejects.toThrow('ADHOC_PROGRAM_NOT_FOUND');
    expect(await sessionTable(db).count()).toBe(1);
  });
  it('checks canonical relationship membership on reads, observations and every edit, with realm owner sentinels', async () => {
    const { db, repo, client, stranger, pair } = await fixture();
    const { id } = await repo.createForAthlete('tg:202');
    const { setId } = await oneExercise(repo, id);
    expect(await repo.getRow(id)).toMatchObject({ realmId: pair.realm.realmId, owner: pair.realm.realmId,
      creatorUserId: 'tg:101', athleteUserId: 'tg:202' });
    expect((await exerciseTable(db).toArray())[0].owner).toBe(pair.realm.realmId);
    expect((await setTable(db).toArray())[0].owner).toBe(pair.realm.realmId);
    expect(await stranger.get(id)).toBeNull();
    expect(await stranger.getRow(id)).toBeNull();
    await expect(stranger.saveSet(id, setId, fact)).rejects.toThrow('ADHOC_SESSION_NOT_FOUND');
    expect(await client.get(id)).not.toBeNull();
    await expect(client.saveSet(id, setId, fact)).rejects.toThrow('ADHOC_WRITE_FORBIDDEN');
    expect(await client.list()).toEqual([]); // open list belongs to the initiator
    const next = vi.fn(), open = vi.fn(), error = vi.fn();
    const detailSubscription = repo.observe(id, next, error);
    const openSubscription = repo.observeOpen(open, error);
    try {
      await vi.waitFor(() => expect(next.mock.lastCall?.[1]?.id).toBe(id));
      await db.table('members').delete(pair.members[1].id);
      await vi.waitFor(() => expect(next.mock.lastCall?.[0]).toBeNull());
      await vi.waitFor(() => expect(open.mock.lastCall?.[0]).toEqual([]));
      await expect(repo.complete(id)).rejects.toThrow('ADHOC_SESSION_NOT_FOUND');
      expect(error).not.toHaveBeenCalled();
    } finally { detailSubscription.unsubscribe(); openSubscription.unsubscribe(); }
  });
  it('refuses participant-owned shared headers and mismatched realm/session child associations', async () => {
    const { db, repo } = await fixture();
    const first = await repo.createForAthlete('tg:101');
    const { exerciseId, setId } = await oneExercise(repo, first.id);
    const row = await repo.getRow(first.id);
    if (!row?.programId) throw new Error('Missing program');
    await setTable(db).update(setId, { realmId: 'tg:303' });
    await expect(repo.deleteSet(first.id, setId)).rejects.toThrow('ADHOC_SET_NOT_FOUND');
    await repo.complete(first.id);
    const second = await repo.createForAthlete('tg:101', row.programId);
    await expect(repo.saveSet(second.id, setId, fact)).rejects.toThrow('ADHOC_SET_NOT_FOUND');
    await expect(repo.addSet(second.id, exerciseId)).rejects.toThrow('ADHOC_EXERCISE_NOT_FOUND');
    await repo.complete(second.id);
    const shared = await repo.createForAthlete('tg:202');
    await sessionTable(db).update(shared.id, { owner: 'tg:101' });
    expect(await repo.get(shared.id)).toBeNull();
  });
  it('saves only FACT fields, validates input, preserves identity, and does not replace unrelated sets', async () => {
    const { db, repo } = await fixture();
    const { id } = await repo.createForAthlete('tg:101');
    const { exerciseId, setId } = await oneExercise(repo, id);
    await repo.addSet(id, exerciseId);
    const before = await setTable(db).get(setId);
    const other = (await setTable(db).toArray()).find(row => row.id !== setId);
    await repo.saveSet(id, setId, fact);
    expect(await setTable(db).get(setId)).toMatchObject({ id: before?.id, sessionId: id, exerciseId,
      realmId: 'tg:101', owner: 'tg:101', actualReps: 8, actualWeightKg: 70, setStatus: 'completed' });
    expect(await setTable(db).get(other!.id)).toEqual(other);
    const persisted = await setTable(db).get(setId);
    for (const invalid of [
      { ...fact, metrics: { ...fact.metrics, reps: 1.5 } },
      { ...fact, metrics: { ...fact.metrics, weightKg: Infinity } },
      { ...fact, metrics: { ...fact.metrics, durationSeconds: -1 } },
      { ...fact, rpe: 11 },
    ]) await expect(repo.saveSet(id, setId, invalid)).rejects.toThrow('ADHOC_INVALID_FACT');
    expect(await setTable(db).get(setId)).toEqual(persisted);
    await repo.complete(id);
    await expect(repo.saveSet(id, setId, fact)).rejects.toThrow('ADHOC_SESSION_COMPLETED');
  });
  it('persists exact order and tombstones sets and exercises while ignoring late sets beneath deleted exercises', async () => {
    const { db, repo } = await fixture();
    const { id } = await repo.createForAthlete('tg:101');
    await repo.addExercises(id, ['0001', '0002']);
    const exercises = (await repo.get(id))!.exercises;
    const order = exercises.map(row => row.sessionExerciseId).reverse();
    await repo.reorder(id, order);
    expect((await repo.get(id))?.exercises.map(row => row.sessionExerciseId)).toEqual(order);
    await expect(repo.reorder(id, [order[0]])).rejects.toThrow('ADHOC_EXERCISES_CHANGED');
    const removed = exercises[0];
    await repo.deleteExercise(id, removed.sessionExerciseId);
    expect((await exerciseTable(db).get(removed.sessionExerciseId))?.deletedAt).toBeTruthy();
    expect((await setTable(db).get(removed.sets[0].sessionSetId))?.deletedAt).toBeTruthy();
    const original = (await setTable(db).get(removed.sets[0].sessionSetId))!;
    await setTable(db).add({ ...original, id: 'late-set', deletedAt: null });
    expect((await repo.get(id))?.exercises).toHaveLength(1);
    await expect(repo.saveSet(id, 'late-set', fact)).rejects.toThrow('ADHOC_EXERCISE_NOT_FOUND');
    const remaining = (await repo.get(id))!.exercises[0];
    await repo.deleteSet(id, remaining.sets[0].sessionSetId);
    expect((await repo.get(id))?.exercises[0].sets).toEqual([]);
    expect(await setTable(db).count()).toBe(3);
  });
  it('fails closed on malformed synchronized headers and filters malformed exercises and FACT rows without crashing', async () => {
    const { db, repo } = await fixture();
    const { id } = await repo.createQuick();
    const { exerciseId, setId } = await oneExercise(repo, id);
    const header = await repo.getRow(id);
    if (!header) throw new Error('Missing header');
    for (const patch of [{ status: 'scheduled' }, { startedAt: 'invalid' }, { startedAt: null }, { name: null },
      { comment: [] }, { templateSaveDecision: 'saved' }, { createdAt: null }, { owner: null }]) {
      await db.table('adHocSessions').put({ ...header, ...patch });
      expect(await repo.get(id)).toBeNull();
      expect(await repo.list()).toEqual([]);
      await expect(repo.rename(id, 'Новая')).rejects.toThrow('ADHOC_SESSION_NOT_FOUND');
    }
    await db.table('adHocSessions').put(header);
    const set = await setTable(db).get(setId);
    if (!set) throw new Error('Missing set');
    for (const patch of [{ bands: null }, { setType: 'invalid' }, { actualReps: '8' },
      { actualWeightKg: NaN }, { setStatus: [] }, { comment: [] }]) {
      await db.table('adHocSets').put({ ...set, ...patch });
      expect((await repo.get(id))?.exercises[0].sets).toEqual([]);
      await expect(repo.saveSet(id, setId, fact)).rejects.toThrow('ADHOC_SET_NOT_FOUND');
    }
    await db.table('adHocSets').put(set);
    await db.table('adHocExercises').update(exerciseId, { exercise: { trackingType: 'invalid' } });
    expect((await repo.get(id))?.exercises).toEqual([]);
    await expect(repo.addSet(id, exerciseId)).rejects.toThrow('ADHOC_EXERCISE_NOT_FOUND');
  });
  it('exports only skeleton exercises, order and set types after an explicit save decision, never PLAN or FACT', async () => {
    const { db, repo } = await fixture();
    const { id } = await repo.createForAthlete('tg:101');
    await repo.addExercises(id, ['0001', '0002']);
    const exercises = (await repo.get(id))!.exercises;
    await repo.saveSet(id, exercises[0].sets[0].sessionSetId, fact);
    await repo.addSet(id, exercises[0].sessionExerciseId);
    await repo.comment(id, 'session only');
    await repo.reorder(id, exercises.map(row => row.sessionExerciseId).reverse());
    await repo.complete(id);
    await repo.resolveTemplate(id, true);
    expect((await repo.getRow(id))?.templateSaveDecision).toBe('saved');
    expect(await repo.list()).toEqual([]);
    const templateExercises = (await db.table('programExercises').toArray()).sort((a, b) => a.position - b.position);
    expect(templateExercises.map(row => row.exercise.exerciseDefinitionId)).toEqual(['0002', '0001']);
    const templateSets = await db.table('programSets').toArray();
    expect(templateSets).toHaveLength(3);
    for (const row of templateSets) {
      expect(row).toMatchObject({ plannedReps: null, plannedWeightKg: null, plannedDurationSeconds: null,
        plannedDistanceMeters: null, comment: null });
      expect(row.setLabel ?? null).toBeNull();
      for (const forbidden of ['actualReps', 'actualWeightKg', 'metrics', 'fact', 'rpe', 'bands'])
        expect(row).not.toHaveProperty(forbidden);
    }
    const copied = templateSets.filter(row => row.programExerciseId === templateExercises[1].id);
    expect(copied.map(row => row.setType)).toEqual(['cluster', 'cluster']);
    await repo.resolveTemplate(id, true); // retry is idempotent
    expect(await db.table('programSets').count()).toBe(3);
    await expect(repo.resolveTemplate(id, false)).rejects.toThrow('ADHOC_TEMPLATE_ALREADY_RESOLVED');
    expect((await repo.get(id))?.exercises[1].sets[0].fact?.metrics).toEqual(fact.metrics);
  });
  it('rolls back template writes and leaves the prompt pending when the decision cannot be persisted', async () => {
    const { db, repo } = await fixture();
    const { id } = await repo.createForAthlete('tg:101');
    await oneExercise(repo, id);
    await repo.complete(id);
    sessionTable(db).hook('updating', patch => {
      if ('templateSaveDecision' in patch && patch.templateSaveDecision === 'saved') throw new Error('decision failed');
    });
    await expect(repo.resolveTemplate(id, true)).rejects.toThrow('decision failed');
    expect((await repo.getRow(id))?.templateSaveDecision).toBe('pending');
    expect(await db.table('programExercises').count()).toBe(0);
    expect(await db.table('programSets').count()).toBe(0);
  });
});

describe('client visibility of coach-owned FACT over the shared realm', () => {
  it('streams newly created sessions and revised FACT to the assigned client only', async () => {
    const { repo, client, stranger, db, pair } = await fixture();
    const rows = vi.fn(), details = vi.fn(), errors = vi.fn();
    const open = client.observeForClient(rows, errors);
    try {
      await vi.waitFor(() => expect(rows.mock.lastCall?.[0]).toEqual([]));
      const { id } = await repo.createForAthlete('tg:202');
      const { setId } = await oneExercise(repo, id);
      await vi.waitFor(() => expect(rows.mock.lastCall?.[0]).toEqual([
        { id, name: 'Тренировка', status: 'active' },
      ]));
      expect(await stranger.listForClient()).toEqual([]);
      expect(await repo.listForClient()).toEqual([]);
      expect(await client.list()).toEqual([]); // creator-only list is unchanged
      const observation = client.observe(id, details, errors);
      try {
        await vi.waitFor(() => expect(details.mock.lastCall?.[0]?.exercises[0]?.sets[0]?.sessionSetId).toBe(setId));
        await repo.saveSet(id, setId, fact);
        await vi.waitFor(() => expect(details.mock.lastCall?.[0]?.exercises[0]?.sets[0]?.fact?.metrics)
          .toEqual(fact.metrics));
        expect(await client.get(id)).toMatchObject({
          exercises: [{ sets: [{ fact: { metrics: fact.metrics } }] }],
        });
        const revisedFact = { ...fact, metrics: { ...fact.metrics, weightKg: 62, reps: 12 } };
        await repo.saveSet(id, setId, revisedFact);
        await vi.waitFor(() => expect(details.mock.lastCall?.[0]?.exercises[0]?.sets[0]?.fact?.metrics)
          .toEqual(revisedFact.metrics));
        await expect(client.saveSet(id, setId, fact)).rejects.toThrow('ADHOC_WRITE_FORBIDDEN');
        await db.table('members').delete(pair.members[1].id);
        await vi.waitFor(() => expect(rows.mock.lastCall?.[0]).toEqual([]));
        await vi.waitFor(() => expect(details.mock.lastCall?.[0]).toBeNull());
        expect(await client.listForClient()).toEqual([]);
        expect(await client.get(id)).toBeNull();
      } finally {
        observation.unsubscribe();
      }
      expect(errors).not.toHaveBeenCalled();
    } finally {
      open.unsubscribe();
    }
  });

  it('does not expose personal, unrelated, or completed workouts in the client active view', async () => {
    const { repo, client, stranger } = await fixture();
    const personal = await repo.createQuick();
    expect(await client.listForClient()).toEqual([]);
    await repo.complete(personal.id);
    const created = await repo.createForAthlete('tg:202');
    expect((await client.listForClient()).map(row => row.id)).toEqual([created.id]);
    expect(await stranger.listForClient()).toEqual([]);
    await repo.complete(created.id);
    expect(await client.listForClient()).toEqual([]);
    // Completed sessions remain readable when an authorized detail ID is known;
    // history placement is outside this PR.
    expect((await client.get(created.id))?.status).toBe('completed');
  });
});
