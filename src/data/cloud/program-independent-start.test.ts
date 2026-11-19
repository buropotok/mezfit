import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import baseline from '../../../cloud/roles.json';
import grants from '../../../cloud/client-session-roles.json';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import { CLOUD_DATABASE_STORES_V12, type MezfitCloudDatabase } from './database';
import { AdHocWorkoutRepository, type AdHocExerciseRow, type AdHocSetRow } from './adhoc-workouts';
import { ClientWorkoutRepository } from './client-workouts';
import type { PublicExerciseRow } from '../exercises/publicExerciseTypes';

const dbs: Dexie[] = [];
afterEach(async () => { for (const db of dbs.splice(0)) await db.delete(); });
const sha = 'a'.repeat(64);
function definition(id: string): PublicExerciseRow {
  return {
    id, realmId: 'rlm-public', owner: null, sourceSha256: sha,
    name: 'Press', name_ru: 'Жим', name_en: 'Press', category: 'chest',
    subcategory: 'chest', subcategory_ru: 'Грудь', movement_type: 'resistance',
    tracking_type: 'weight_reps', muscles: { primary: [], secondary: [], stabilizers: [], emphasis: [] },
    mobility_targets: [], equipment: 'barbell', body_part: 'chest', target: 'chest',
    muscle_group: 'chest', secondary_muscles: [], media_id: id, image: '', gif_url: '',
    attribution: '', created_at: '', instructions: { ru: '', en: '' },
    instruction_steps: { ru: [], en: [] }, source_consistency_issue: null,
    anatomy_evidence: { classification_family: '', basis: '', external_individual_match: false },
  };
}
async function fixture(clientGrant = true) {
  const db = new Dexie('program-independent-' + crypto.randomUUID(), { addons: [] });
  dbs.push(db);
  const stores: Record<string, string | null> = {};
  for (const [table, schema] of Object.entries(CLOUD_DATABASE_STORES_V12))
    stores[table] = schema?.replaceAll('@', '') ?? null;
  db.version(12).stores({ ...stores, localProgramSync: 'id' });
  for (const table of ['adHocSessions', 'adHocExercises', 'adHocSets', 'trainingPlans',
    'programPhases', 'programDays', 'programExercises', 'programSets'])
    db.table(table).hook('creating', key => key === undefined ? crypto.randomUUID() : undefined);
  const pair = await relationshipMembership('101', '202');
  await db.table('realms').add(pair.realm);
  await db.table('members').bulkAdd(pair.members);
  await db.table('roles').add({ realmId: 'rlm-public', name: 'coach', ...baseline.roles.coach });
  const base = baseline.roles.client.permissions;
  const overlay = grants.roles.client.permissions;
  await db.table('roles').add({ realmId: 'rlm-public', name: 'client', permissions: clientGrant ? {
    add: [...base.add, ...overlay.add],
    update: { ...base.update, ...overlay.update,
      workoutOccurrences: [...base.update.workoutOccurrences, 'inactive', ...overlay.update.workoutOccurrences] },
  } : base });
  await db.table('publicExerciseDefinitions').add(definition('0001'));
  await db.table('publicExerciseCatalogues').add({
    id: 'mezfit:exercise-catalogue', realmId: 'rlm-public', owner: null,
    sourceSha256: sha, schemaVersion: '2.0.0', catalogue: 'mezfit.exercise_catalog.ru_anatomy',
    exerciseCount: 1324, taxonomyCount: 69, subcategoryLabelsRu: {}, movementFamilyReferences: {},
    metadata: {}, publishedAt: '2026-10-27',
  });
  const database = db as unknown as MezfitCloudDatabase;
  const coach = new AdHocWorkoutRepository(database, 'tg:101');
  const client = new ClientWorkoutRepository(database, 'tg:202');
  const programId = await coach.programs.createAssigned('tg:202', 'Силовая');
  const phaseId = (await coach.programs.details(programId))!.phases[0].id;
  const dayId = await coach.programs.createDay(programId, phaseId, 'День А');
  await coach.programs.addDayExercises(programId, dayId, ['0001']);
  const exercise = (await db.table('programExercises').toArray())[0];
  await coach.programs.addExerciseSet(programId, dayId, exercise.id);
  const sourceSet = (await db.table('programSets').toArray())[0];
  await db.table('programSets').update(sourceSet.id, { plannedReps: 12, plannedWeightKg: 70,
    plannedDistanceMeters: 150, plannedDurationSeconds: 90 });
  await coach.programs.activate(programId, phaseId);
  return { db, coach, client, programId, dayId, exercise, sourceSet };
}

describe('direct independent workout start from program', () => {
  it('starts a client FACT with empty values and preserves the complete reusable program', async () => {
    const { db, client, programId, dayId, exercise, sourceSet } = await fixture();
    const beforeProgram = await db.table('trainingPlans').get(programId);
    const beforeExercise = await db.table('programExercises').get(exercise.id);
    const beforeSet = await db.table('programSets').get(sourceSet.id);
    const result = await client.createIndependentFromProgramDay('tg:202', programId, dayId);
    const session = await client.get(result.id);
    expect(result.createdProgram).toBe(false);
    expect(session?.format).toBe('independent');
    expect(session?.occurrenceId).toBeNull();
    expect(session?.program).toMatchObject({ id: programId, name: 'Силовая' });
    expect(session?.exercises[0].exercise.id).toBe('0001');
    expect(session?.exercises[0].sets).toHaveLength(1);
    expect(session?.exercises[0].sets[0]).toMatchObject({
      plan: null, status: 'pending',
      fact: { metrics: { reps: null, weightKg: null, durationSeconds: null, distanceMeters: null } },
    });
    expect(await db.table('workoutOccurrences').count()).toBe(0);
    expect(await db.table('trainingPlans').get(programId)).toEqual(beforeProgram);
    expect(await db.table('programExercises').get(exercise.id)).toEqual(beforeExercise);
    expect(await db.table('programSets').get(sourceSet.id)).toEqual(beforeSet);
    expect(await db.table<AdHocExerciseRow>('adHocExercises').count()).toBe(1);
    expect(await db.table<AdHocSetRow>('adHocSets').count()).toBe(1);
    await expect(client.createIndependentFromProgramDay('tg:202', programId, dayId))
      .rejects.toThrow('ADHOC_ACTIVE_SESSION_EXISTS');
  });

  it('lets the Coach start an explicitly independent session for the assigned athlete', async () => {
    const { db, coach, programId, dayId } = await fixture();
    const result = await coach.createIndependentFromProgramDay('tg:202', programId, dayId);
    expect(await coach.getRow(result.id)).toMatchObject({
      creatorUserId: 'tg:101', athleteUserId: 'tg:202', format: 'independent',
      programId, dayId, status: 'active',
    });
    expect((await coach.get(result.id))?.format).toBe('independent');
    expect(await db.table('workoutOccurrences').count()).toBe(0);
  });

  it('persists coached format for Coach direct Start without altering source PLAN or creating a calendar event', async () => {
    const { db, coach, programId, dayId, exercise, sourceSet } = await fixture();
    const beforePlan = await db.table('trainingPlans').get(programId);
    const beforeExercise = await db.table('programExercises').get(exercise.id);
    const beforeSet = await db.table('programSets').get(sourceSet.id);
    const result = await coach.createForAthlete('tg:202', programId, dayId, { format: 'coached' });
    const session = await coach.get(result.id);
    expect(result.createdProgram).toBe(false);
    expect(await coach.getRow(result.id)).toMatchObject({ format: 'coached',
      athleteUserId: 'tg:202', creatorUserId: 'tg:101', programId, dayId });
    expect(session?.format).toBe('coached');
    expect(session?.occurrenceId).toBeNull();
    expect(session?.exercises[0].sets[0]).toMatchObject({
      plan: null, fact: { metrics: { reps: null, weightKg: null } },
    });
    expect(await db.table('workoutOccurrences').count()).toBe(0);
    expect(await db.table('trainingPlans').get(programId)).toEqual(beforePlan);
    expect(await db.table('programExercises').get(exercise.id)).toEqual(beforeExercise);
    expect(await db.table('programSets').get(sourceSet.id)).toEqual(beforeSet);
  });

  it('rejects a foreign athlete or missing client execution grants without creating a session', async () => {
    const { db, client, programId, dayId } = await fixture(false);
    await expect(client.createIndependentFromProgramDay('tg:101', programId, dayId))
      .rejects.toThrow('ADHOC_WRITE_FORBIDDEN');
    await expect(client.createIndependentFromProgramDay('tg:202', programId, dayId))
      .rejects.toThrow('CLIENT_EXECUTION_ACL_REQUIRED');
    expect(await db.table('adHocSessions').count()).toBe(0);
    expect(await db.table('workoutOccurrences').count()).toBe(0);
  });
});
