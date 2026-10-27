import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import roles from '../../../cloud/roles.json';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import { CLOUD_DATABASE_STORES_V12, type MezfitCloudDatabase } from './database';
import { AdHocWorkoutRepository, type AdHocExerciseRow, type AdHocSetRow } from './adhoc-workouts';
import { PlannedWorkoutsRepository, plannedWorkoutRange } from './planned-workouts';
import { STARTED_PLAN_MESSAGE } from './planned-session-policy';
import { WorkoutOccurrenceDraftRepository } from './workout-occurrence-drafts';
import { snapshotProgramDay } from './workout-occurrence-plan';
import type { CloudWorkoutOccurrenceRow } from './workout-foundation-types';
import type { PublicExerciseRow } from '../exercises/publicExerciseTypes';
import type { SetEntryFactDraft } from '../../workout/setEntryTypes';

const databases: Dexie[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
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

const sourceTables = ['trainingPlans', 'programPhases', 'programDays', 'programExercises', 'programSets'];
const sourceGraph = (db: Dexie) => Promise.all(sourceTables.map(table => db.table(table).toArray()));
const exercises = (db: Dexie) => db.table<AdHocExerciseRow, string>('adHocExercises');
const sets = (db: Dexie) => db.table<AdHocSetRow, string>('adHocSets');
const occurrences = (db: Dexie) => db.table<CloudWorkoutOccurrenceRow, string>('workoutOccurrences');
const fact: SetEntryFactDraft = {
  metrics: { reps: 8, weightKg: 70, durationSeconds: null, distanceMeters: null },
  setLabel: 'hard', setType: 'cluster', rpe: 8, comment: 'FACT only', bands: ['red'],
};

async function fixture(shared = false, lifecycleGrant = true) {
  const db = new Dexie('planned-workouts-' + crypto.randomUUID(), { addons: [] });
  databases.push(db);
  const stores: Record<string, string | null> = {};
  for (const [table, schema] of Object.entries(CLOUD_DATABASE_STORES_V12))
    stores[table] = schema?.replaceAll('@', '') ?? null;
  db.version(12).stores({ ...stores, localProgramSync: 'id', localWorkoutSync: 'id' });
  // Emulate Addon's generated IDs, retaining real IndexedDB transactions/liveQuery.
  for (const table of [...sourceTables, 'workoutOccurrences', 'adHocSessions', 'adHocExercises', 'adHocSets'])
    db.table(table).hook('creating', key => key === undefined ? crypto.randomUUID() : undefined);
  const pair = await relationshipMembership('101', '202');
  await db.table('realms').add(pair.realm);
  await db.table('members').bulkAdd(pair.members);
  const coach = structuredClone(roles.roles.coach);
  await db.table('roles').add({ realmId: 'rlm-public', name: 'coach', ...coach,
    permissions: { ...coach.permissions, add: [...coach.permissions.add, 'adHocSessions', 'adHocExercises', 'adHocSets'], update: { ...coach.permissions.update,
      workoutOccurrences: [...coach.permissions.update.workoutOccurrences,
        ...(lifecycleGrant ? ['status', 'workoutSessionId'] : [])] } } });
  await db.table('publicExerciseDefinitions').add(definition('0001'));
  await db.table('publicExerciseCatalogues').add({ id: 'mezfit:exercise-catalogue', realmId: 'rlm-public',
    owner: null, sourceSha256: sha, schemaVersion: '2.0.0', catalogue: 'mezfit.exercise_catalog.ru_anatomy',
    exerciseCount: 1324, taxonomyCount: 69, subcategoryLabelsRu: {}, movementFamilyReferences: {},
    metadata: {}, publishedAt: '2026-10-27' });
  const database = db as unknown as MezfitCloudDatabase;
  const repo = new AdHocWorkoutRepository(database, 'tg:101');
  const programId = shared
    ? await repo.programs.createAssigned('tg:202', 'Source program')
    : await repo.programs.createPersonal('Source program');
  const phase = (await repo.programs.details(programId))?.phases[0];
  if (!phase) throw new Error('Missing fixture phase');
  const dayId = await repo.programs.createDay(programId, phase.id, 'Source day');
  await repo.programs.addDayExercises(programId, dayId, ['0001']);
  const details = await repo.programs.details(programId);
  const day = details?.days?.find(item => item.day.id === dayId);
  if (!day) throw new Error('Missing fixture day');
  await repo.programs.addExerciseSet(programId, dayId, day.exercises[0].exercise.id);
  await repo.programs.addExerciseSet(programId, dayId, day.exercises[0].exercise.id);
  const outline = (await repo.programs.details(programId))?.days?.find(item => item.day.id === dayId);
  if (!outline) throw new Error('Missing fixture outline');
  const plan = snapshotProgramDay(outline);
  plan.name = 'Accepted occurrence';
  plan.comment = 'PLAN comment';
  plan.exercises[0].notes = 'PLAN exercise note';
  for (const set of plan.exercises[0].sets) {
    set.plannedReps = 12;
    set.plannedWeightKg = 50;
    set.setType = 'rest_pause';
    set.setLabel = 'warmup';
    set.comment = 'PLAN set note';
  }
  const timestamp = '2026-10-27T08:00:00.000Z';
  const row: CloudWorkoutOccurrenceRow = {
    id: 'occurrence-one', realmId: shared ? pair.realm.realmId : 'tg:101',
    owner: shared ? pair.realm.realmId : 'tg:101', athleteUserId: shared ? 'tg:202' : 'tg:101',
    coachUserId: shared ? 'tg:101' : null, clientUserId: shared ? 'tg:202' : null,
    trainingPlanId: programId, programDayId: dayId, format: shared ? 'coached' : 'independent',
    startsAtUtc: timestamp, durationMinutes: 60, status: 'scheduled', workoutSessionId: null,
    publicationStatus: 'draft', draftAuthorUserId: 'tg:101', createdByUserId: 'tg:101',
    plan, originalPlan: structuredClone(plan), publishedPlan: null, createdAt: timestamp, updatedAt: timestamp,
  };
  await occurrences(db).add(row);
  return { db, database, pair, repo, row, programId, dayId,
    drafts: new WorkoutOccurrenceDraftRepository(database, 'tg:101'),
    planned: new PlannedWorkoutsRepository(database, 'tg:101') };
}

async function expectNoExecution(db: Dexie, before: CloudWorkoutOccurrenceRow) {
  for (const table of ['adHocSessions', 'adHocExercises', 'adHocSets', 'localWorkoutSync'])
    expect(await db.table(table).count()).toBe(0);
  expect(await occurrences(db).get(before.id)).toEqual(before);
}

describe('planned workout execution', () => {
  it.each([false, true])('atomically freezes PLAN, links the same occurrence and keeps FACT separate (shared=%s)', async shared => {
    const { db, repo, row, drafts } = await fixture(shared);
    const before = await sourceGraph(db);
    const fetch = vi.fn(() => Promise.reject(new Error('offline')));
    vi.stubGlobal('fetch', fetch);
    const result = await repo.createFromOccurrence(row.id);
    expect(result).toEqual({ id: expect.any(String), createdProgram: false });
    expect(await occurrences(db).count()).toBe(1);
    expect(await occurrences(db).get(row.id)).toMatchObject({ status: 'in_progress',
      workoutSessionId: result.id, publicationStatus: 'published', plan: row.plan, publishedPlan: row.plan });
    expect(await repo.getRow(result.id)).toMatchObject({ occurrenceId: row.id, occurrencePlan: row.plan,
      realmId: row.realmId, owner: row.realmId, athleteUserId: row.athleteUserId, autoCreatedProgram: false });
    const [exercise] = await exercises(db).toArray();
    expect(exercise).toMatchObject({ sessionId: result.id, realmId: row.realmId, owner: row.realmId,
      occurrenceExerciseId: row.plan.exercises[0].id });
    const children = (await sets(db).toArray()).sort((a, b) => a.position - b.position);
    expect(children.map(set => set.occurrenceSetId)).toEqual(row.plan.exercises[0].sets.map(set => set.id));
    for (const set of children) {
      expect(set).toMatchObject({ sessionId: result.id, exerciseId: exercise.id, realmId: row.realmId,
        owner: row.realmId, actualReps: null, actualWeightKg: null, actualDurationSeconds: null,
        actualDistanceMeters: null, comment: null, setLabel: null, rpe: null, bands: [], setStatus: 'pending' });
      expect(set).not.toHaveProperty('plannedReps');
    }
    const prescribed = { reps: 12, weightKg: 50, durationSeconds: null, distanceMeters: null };
    expect((await repo.get(result.id))?.exercises[0].sets[0]).toMatchObject({ plan: prescribed,
      previous: null, fact: { metrics: { reps: null, weightKg: null, durationSeconds: null, distanceMeters: null }, comment: null } });
    await repo.saveSet(result.id, children[0].id, fact);
    expect((await repo.get(result.id))?.exercises[0].sets[0]).toMatchObject({ plan: prescribed,
      fact: { metrics: fact.metrics, comment: fact.comment } });
    expect(await repo.getRow(result.id)).toMatchObject({ occurrencePlan: row.plan });
    expect(await exercises(db).get(exercise.id)).toEqual(exercise);
    expect(await sets(db).get(children[0].id)).toMatchObject({ occurrenceSetId: children[0].occurrenceSetId });
    expect(await sets(db).get(children[1].id)).toEqual(children[1]);
    expect(await sourceGraph(db)).toEqual(before);
    expect(await drafts.get('draft:' + row.id)).toMatchObject({ plan: row.plan,
      executionStatus: 'in_progress', workoutSessionId: result.id });
    expect(await db.table('localWorkoutSync').get(row.id)).toMatchObject({ confirmed: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reuses the active link, excludes quick/program starts, and completes the same occurrence idempotently', async () => {
    const { db, repo, row, programId, dayId, drafts } = await fixture();
    const first = await repo.createFromOccurrence(row.id);
    const before = await repo.getRow(first.id);
    expect(await repo.createFromOccurrence(row.id)).toEqual(first);
    expect(await repo.getRow(first.id)).toEqual(before);
    await expect(repo.createQuick()).rejects.toThrow('ADHOC_ACTIVE_SESSION_EXISTS');
    await expect(repo.createForAthlete('tg:101', programId, dayId)).rejects.toThrow('ADHOC_ACTIVE_SESSION_EXISTS');
    expect(await db.table('adHocSessions').count()).toBe(1);
    await repo.complete(first.id);
    const completed = await repo.getRow(first.id);
    await repo.complete(first.id);
    expect(await repo.getRow(first.id)).toEqual(completed);
    expect(await occurrences(db).get(row.id)).toMatchObject({ status: 'completed', workoutSessionId: first.id });
    expect(await drafts.get('draft:' + row.id)).toMatchObject({ executionStatus: 'completed', workoutSessionId: first.id });
    await expect(repo.createFromOccurrence(row.id)).rejects.toThrow('PLANNED_WORKOUT_ALREADY_COMPLETED');
    await expect(repo.createQuick()).resolves.toMatchObject({ createdProgram: false });
  });

  it.each(['quick', 'program'] as const)('refuses scheduled Start while a %s session is active', async kind => {
    const { db, repo, row, programId, dayId } = await fixture();
    const active = kind === 'quick' ? await repo.createQuick() : await repo.createForAthlete('tg:101', programId, dayId);
    await expect(repo.createFromOccurrence(row.id)).rejects.toThrow('ADHOC_ACTIVE_SESSION_EXISTS');
    expect(await occurrences(db).get(row.id)).toEqual(row);
    expect(await db.table('adHocSessions').count()).toBe(1);
    expect((await repo.getActive())?.id).toBe(active.id);
  });

  it('rolls back the header, earlier children, link and sync metadata when a later child fails', async () => {
    const { db, repo, row } = await fixture();
    const before = await sourceGraph(db);
    let inserts = 0;
    sets(db).hook('creating', () => {
      if (++inserts === 2) throw new Error('planned child insertion failed');
    });
    await expect(repo.createFromOccurrence(row.id)).rejects.toThrow('planned child insertion failed');
    expect(inserts).toBe(2);
    await expectNoExecution(db, row);
    expect(await sourceGraph(db)).toEqual(before);
  });

  it('rejects a shared Start without both lifecycle ACL fields before inserting anything', async () => {
    const { db, repo, row } = await fixture(true, false);
    const before = await sourceGraph(db);
    await expect(repo.createFromOccurrence(row.id)).rejects.toThrow('PLANNED_START_ACL_REQUIRED');
    await expectNoExecution(db, row);
    expect(await sourceGraph(db)).toEqual(before);
  });

  it('keeps the session and occurrence active if shared lifecycle grants are removed before completion', async () => {
    const { db, repo, row } = await fixture(true);
    const created = await repo.createFromOccurrence(row.id);
    await db.table('roles').update(['rlm-public', 'coach'], {
      'permissions.update.workoutOccurrences': roles.roles.coach.permissions.update.workoutOccurrences,
    });
    await expect(repo.complete(created.id)).rejects.toThrow('PLANNED_START_ACL_REQUIRED');
    expect((await repo.getRow(created.id))?.status).toBe('active');
    expect(await occurrences(db).get(row.id)).toMatchObject({ status: 'in_progress', workoutSessionId: created.id });
  });

  it('denies clients, foreign actors and revoked canonical membership without mutations', async () => {
    const { db, database, pair, repo, row } = await fixture(true);
    for (const actor of ['tg:202', 'tg:303']) {
      await expect(new AdHocWorkoutRepository(database, actor).createFromOccurrence(row.id))
        .rejects.toThrow('PLANNED_WORKOUT_NOT_FOUND');
      await expectNoExecution(db, row);
    }
    await db.table('members').delete(pair.members[1].id);
    await expect(repo.createFromOccurrence(row.id)).rejects.toThrow('PLANNED_WORKOUT_NOT_FOUND');
    await expectNoExecution(db, row);
  });

  it('denies a foreign personal occurrence even when its ID and PLAN are locally present', async () => {
    const { db, database, row } = await fixture();
    await expect(new AdHocWorkoutRepository(database, 'tg:303').createFromOccurrence(row.id))
      .rejects.toThrow('PLANNED_WORKOUT_NOT_FOUND');
    await expectNoExecution(db, row);
  });

  it('serializes two editors starting the same occurrence into one execution graph', async () => {
    const { db, database, repo, row } = await fixture();
    const second = new AdHocWorkoutRepository(database, 'tg:101');
    const results = await Promise.all([repo.createFromOccurrence(row.id), second.createFromOccurrence(row.id)]);
    expect(results[1]).toEqual(results[0]);
    expect(await db.table('adHocSessions').count()).toBe(1);
    expect(await exercises(db).count()).toBe(row.plan.exercises.length);
    expect(await sets(db).count()).toBe(row.plan.exercises[0].sets.length);
    expect(await occurrences(db).get(row.id)).toMatchObject({ workoutSessionId: results[0].id, status: 'in_progress' });
  });

  it('rejects a stale queued editor intent after another editor starts, then discards that intent', async () => {
    const { db, database, repo, row, drafts } = await fixture();
    const id = 'draft:' + row.id;
    const otherEditor = new WorkoutOccurrenceDraftRepository(database, 'tg:101');
    const failure = vi.spyOn(drafts, 'edit').mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(drafts.replacePlan(id, { ...row.plan, name: 'Stale queued PLAN' })).rejects.toThrow('storage unavailable');
    failure.mockRestore();
    const started = await repo.createFromOccurrence(row.id);
    await expect(otherEditor.flushEdits(id)).rejects.toThrow(new Error(STARTED_PLAN_MESSAGE));
    await expect(drafts.flushEdits(id)).resolves.toBeUndefined();
    expect(otherEditor.pendingEditError(id)).toBe('');
    expect(await occurrences(db).get(row.id)).toMatchObject({ plan: row.plan, publicationStatus: 'published' });
    expect(await repo.getRow(started.id)).toMatchObject({ occurrencePlan: row.plan });
  });

  it.each(['content', 'save', 'delete', 'cancel'] as const)('rejects %s after Start with the exact started-PLAN message', async operation => {
    const { db, repo, row, drafts } = await fixture();
    await repo.createFromOccurrence(row.id);
    const before = await occurrences(db).get(row.id);
    const id = 'draft:' + row.id;
    const action = operation === 'content' ? drafts.replacePlan(id, { ...row.plan, name: 'Too late' })
      : operation === 'save' ? drafts.save(id)
      : operation === 'delete' ? drafts.delete(id) : drafts.cancel(row.id);
    await expect(action).rejects.toThrow(new Error(STARTED_PLAN_MESSAGE));
    expect(await occurrences(db).get(row.id)).toEqual(before);
  });

  it('projects the frozen header even after a late direct occurrence PLAN overwrite and source edit', async () => {
    const { db, repo, row, drafts } = await fixture();
    const { id } = await repo.createFromOccurrence(row.id);
    await occurrences(db).update(row.id, { plan: { ...row.plan, name: 'Late overwrite', exercises: [] } });
    await db.table('programSets').toCollection().modify({ plannedReps: 99, plannedWeightKg: 999 });
    expect(await drafts.get('draft:' + row.id)).toMatchObject({ plan: row.plan,
      executionStatus: 'in_progress', workoutSessionId: id });
    expect((await repo.get(id))?.exercises[0].sets[0].plan).toEqual({
      reps: 12, weightKg: 50, durationSeconds: null, distanceMeters: null });
    expect(await repo.getRow(id)).toMatchObject({ occurrencePlan: row.plan });
  });
});

describe('upcoming planned workout projection', () => {
  it.each([new Date(2026, 2, 1, 16, 35), new Date(2026, 9, 25, 16, 35)])('uses fourteen local calendar days from %s with the local offset delta', reference => {
    const { from, until } = plannedWorkoutRange(reference);
    expect(new Date(from)).toEqual(new Date(reference.getFullYear(), reference.getMonth(), reference.getDate()));
    expect(new Date(until)).toEqual(new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() + 14));
    const offsetDelta = new Date(until).getTimezoneOffset() - new Date(from).getTimezoneOffset();
    expect(until - from).toBe(14 * 24 * 60 * 60 * 1000 + offsetDelta * 60 * 1000);
  });

  it('includes local today and the last millisecond, excludes the upper boundary and hidden scopes, and sorts ties by ID', async () => {
    const { db, row, planned } = await fixture();
    const reference = new Date(2026, 9, 27, 17, 30);
    const { from, until } = plannedWorkoutRange(reference);
    await occurrences(db).delete(row.id);
    const at = (id: string, time: number, patch: Partial<CloudWorkoutOccurrenceRow> = {}): CloudWorkoutOccurrenceRow =>
      ({ ...structuredClone(row), id, startsAtUtc: new Date(time).toISOString(), ...patch });
    await occurrences(db).bulkAdd([
      at('last', until - 1), at('tie-b', from + 3600000), at('first', from), at('tie-a', from + 3600000),
      at('before', from - 1), at('upper', until), at('cancelled', from, { status: 'cancelled' }),
      at('cancelled-at', from, { cancelledAt: row.startsAtUtc }),
      at('started', from, { status: 'in_progress', workoutSessionId: 'active-session' }),
      at('completed', from, { status: 'completed', workoutSessionId: 'completed-session' }),
      at('foreign-personal', from, { realmId: 'tg:303', owner: 'tg:303', athleteUserId: 'tg:303' }),
      at('foreign-relationship', from, { realmId: 'foreign-realm', owner: 'foreign-realm', athleteUserId: 'tg:202',
        coachUserId: 'tg:101', clientUserId: 'tg:202', format: 'coached' }),
      at('event', from, { entryKind: 'personal_event', trainingPlanId: undefined, programDayId: undefined,
        publicationStatus: 'published', plan: { name: 'Event', comment: null, exercises: [] } }),
    ]);
    const list = await planned.list(reference);
    expect(list.map(item => item.id)).toEqual(['first', 'tie-a', 'tie-b', 'last']);
    expect(list[0]).toMatchObject({ id: 'first', programName: 'Source program',
      draft: { id: 'draft:first', plan: row.plan } });
  });

  it('includes coached client workouts for their coach, hides them from other scopes, and never leaks a foreign program name', async () => {
    const { db, database, pair, row, planned, programId } = await fixture(true);
    const reference = new Date(row.startsAtUtc);
    expect((await planned.list(reference)).map(item => item.id)).toEqual([row.id]);
    expect(await new PlannedWorkoutsRepository(database, 'tg:202').list(reference)).toEqual([]);
    expect(await new PlannedWorkoutsRepository(database, 'tg:303').list(reference)).toEqual([]);
    await db.table('trainingPlans').update(programId, { realmId: 'tg:303', name: 'Private foreign program' });
    expect((await planned.list(reference))[0].programName).toBeNull();
    await db.table('members').delete(pair.members[1].id);
    expect(await planned.list(reference)).toEqual([]);
  });

  it('observes edits from another editor, publication, and removal when the occurrence starts', async () => {
    const { database, repo, row, planned } = await fixture();
    const next = vi.fn(), error = vi.fn();
    const subscription = planned.observe(new Date(row.startsAtUtc), next, error);
    const editor = new WorkoutOccurrenceDraftRepository(database, 'tg:101');
    try {
      await vi.waitFor(() => expect(next.mock.lastCall?.[0]?.[0]?.draft.plan.name).toBe(row.plan.name));
      await editor.replacePlan('draft:' + row.id, { ...row.plan, name: 'Edited in another sheet' });
      await vi.waitFor(() => expect(next.mock.lastCall?.[0]?.[0]?.draft.plan.name).toBe('Edited in another sheet'));
      await editor.enqueueEdit('draft:' + row.id, draft => ({ ...draft, durationMinutes: 90 }));
      await vi.waitFor(() => expect(next.mock.lastCall?.[0]?.[0]?.draft.durationMinutes).toBe(90));
      await editor.save('draft:' + row.id);
      await vi.waitFor(() => expect(next.mock.lastCall?.[0]?.[0]?.draft.saved).toBe(true));
      const { id } = await repo.createFromOccurrence(row.id);
      await vi.waitFor(() => expect(next.mock.lastCall?.[0]).toEqual([]));
      expect(await repo.getRow(id)).toMatchObject({ occurrencePlan: { name: 'Edited in another sheet' } });
      expect(error).not.toHaveBeenCalled();
    } finally { subscription.unsubscribe(); }
  });
});
