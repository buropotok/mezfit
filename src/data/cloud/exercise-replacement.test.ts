import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import roles from '../../../cloud/roles.json';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import { CLOUD_DATABASE_STORES_V12, type MezfitCloudDatabase } from './database';
import { AdHocWorkoutRepository, type AdHocExerciseRow, type AdHocSetRow } from './adhoc-workouts';
import type { PublicExerciseRow } from '../exercises/publicExerciseTypes';
import type { SetEntryFactDraft } from '../../workout/setEntryTypes';

const dbs: Dexie[] = [];
afterEach(async () => { for (const db of dbs.splice(0)) await db.delete(); });
const sha = 'a'.repeat(64);
function definition(id: string, tracking_type: PublicExerciseRow['tracking_type'] = 'weight_reps'): PublicExerciseRow {
  return {
    id, realmId: 'rlm-public', owner: null, sourceSha256: sha,
    name: id, name_ru: id, name_en: id, category: 'chest',
    subcategory: 'chest', subcategory_ru: 'Грудь', movement_type: 'resistance', tracking_type,
    muscles: { primary: [], secondary: [], stabilizers: [], emphasis: [] }, mobility_targets: [],
    equipment: 'barbell', body_part: 'chest', target: 'chest', muscle_group: 'chest', secondary_muscles: [],
    media_id: id, image: '', gif_url: '', attribution: '', created_at: '', instructions: { ru: '', en: '' },
    instruction_steps: { ru: [], en: [] }, source_consistency_issue: null,
    anatomy_evidence: { classification_family: '', basis: '', external_individual_match: false },
  };
}
async function fixture() {
  const db = new Dexie('replace-exercise-' + crypto.randomUUID(), { addons: [] });
  dbs.push(db);
  const stores: Record<string, string | null> = {};
  for (const [name, schema] of Object.entries(CLOUD_DATABASE_STORES_V12))
    stores[name] = schema?.replaceAll('@', '') ?? null;
  db.version(12).stores({ ...stores, localProgramSync: 'id' });
  for (const name of ['adHocSessions', 'adHocExercises', 'adHocSets', 'trainingPlans',
    'programPhases', 'programDays', 'programExercises', 'programSets'])
    db.table(name).hook('creating', key => key === undefined ? crypto.randomUUID() : undefined);
  const pair = await relationshipMembership('101', '202');
  await db.table('realms').add(pair.realm);
  await db.table('members').bulkAdd(pair.members);
  await db.table('roles').add({ realmId: 'rlm-public', name: 'coach', ...roles.roles.coach });
  await db.table('publicExerciseDefinitions').bulkAdd([
    definition('0001'), definition('0002'), definition('0003', 'time'),
  ]);
  await db.table('publicExerciseCatalogues').add({
    id: 'mezfit:exercise-catalogue', realmId: 'rlm-public', owner: null,
    sourceSha256: sha, schemaVersion: '2.0.0', catalogue: 'mezfit.exercise_catalog.ru_anatomy',
    exerciseCount: 1324, taxonomyCount: 69, subcategoryLabelsRu: {}, movementFamilyReferences: {},
    metadata: {}, publishedAt: '2026-10-27',
  });
  return { db, repo: new AdHocWorkoutRepository(db as unknown as MezfitCloudDatabase, 'tg:101') };
}
const entry: SetEntryFactDraft = {
  metrics: { reps: 8, weightKg: 72.5, durationSeconds: null, distanceMeters: null },
  setLabel: 'hard', setType: 'cluster', rpe: 8, comment: 'Исполнение', bands: ['red'],
};

describe('atomic local exercise replacement', () => {
  it('keeps position, set count, entered metrics and labels with new FACT identities', async () => {
    const { db, repo } = await fixture();
    const { id } = await repo.createQuick();
    await repo.addExercises(id, ['0001']);
    const original = (await repo.get(id))!.exercises[0];
    await repo.saveSet(id, original.sets[0].sessionSetId, entry);
    await repo.addSet(id, original.sessionExerciseId);
    const previous = (await repo.get(id))!.exercises[0];
    await repo.saveSet(id, previous.sets[1].sessionSetId, { ...entry,
      metrics: { ...entry.metrics, reps: 12, weightKg: 55 } });
    expect(await repo.replacementTrackingType('0002')).toBe('weight_reps');
    await repo.replaceExercise(id, original.sessionExerciseId, '0002', true);
    const next = (await repo.get(id))!.exercises;
    expect(next).toHaveLength(1);
    expect(next[0].exercise.id).toBe('0002');
    expect(next[0].position).toBe(0);
    expect(next[0].sessionExerciseId).not.toBe(original.sessionExerciseId);
    expect(next[0].sets).toHaveLength(2);
    expect(next[0].sets.map(set => set.fact?.metrics)).toEqual([
      entry.metrics, { ...entry.metrics, reps: 12, weightKg: 55 },
    ]);
    expect(next[0].sets.map(set => set.status)).toEqual(['completed', 'completed']);
    expect(next[0].sets[0].fact).toMatchObject({ setLabel: 'hard', setType: 'cluster',
      rpe: 8, comment: 'Исполнение', bands: ['red'] });
    expect((await db.table<AdHocExerciseRow>('adHocExercises').get(original.sessionExerciseId))?.deletedAt).toBeTruthy();
    expect((await db.table<AdHocSetRow>('adHocSets').get(original.sets[0].sessionSetId))?.deletedAt).toBeTruthy();
  });

  it('rejects incompatible preservation and unavailable choices without removing the source', async () => {
    const { db, repo } = await fixture();
    const { id } = await repo.createQuick();
    await repo.addExercises(id, ['0001']);
    const original = (await repo.get(id))!.exercises[0];
    await repo.saveSet(id, original.sets[0].sessionSetId, entry);
    expect(await repo.replacementTrackingType('0003')).toBe('time');
    await expect(repo.replaceExercise(id, original.sessionExerciseId, '0003', true))
      .rejects.toThrow('ADHOC_EXERCISE_TRACKING_MISMATCH');
    await expect(repo.replaceExercise(id, original.sessionExerciseId, '9999', false))
      .rejects.toThrow();
    expect((await repo.get(id))!.exercises[0].sessionExerciseId).toBe(original.sessionExerciseId);
    expect(await db.table<AdHocExerciseRow>('adHocExercises').count()).toBe(1);
    await repo.replaceExercise(id, original.sessionExerciseId, '0003', false);
    const next = (await repo.get(id))!.exercises[0];
    expect(next.exercise.tracking_type).toBe('time');
    expect(next.sets).toHaveLength(1);
    expect(next.sets[0]).toMatchObject({ status: 'pending' });
    expect(next.sets[0].fact?.metrics).toEqual({
      reps: null, weightKg: null, durationSeconds: null, distanceMeters: null,
    });
  });

  it('replaces a reusable PLAN at the same position without losing old historical rows', async () => {
    const { db, repo } = await fixture();
    const programId = await repo.programs.createPersonal('План');
    const phaseId = await repo.programs.createPhase(programId, 'Фаза');
    const dayId = await repo.programs.createDay(programId, phaseId, 'День');
    await repo.programs.addDayExercises(programId, dayId, ['0001']);
    const old = (await db.table('programExercises').toArray())[0];
    await repo.programs.addExerciseSet(programId, dayId, old.id);
    const oldSet = (await db.table('programSets').toArray())[0];
    await db.table('programSets').update(oldSet.id, {
      plannedWeightKg: 65, plannedReps: 10, setLabel: 'warmup', comment: 'Старт',
    });
    await repo.programs.replaceDayExercise(programId, dayId, old.id, '0002', true);
    const rows = await db.table('programExercises').toArray();
    const active = rows.find(row => row.status === 'active')!;
    const copy = (await db.table('programSets').toArray()).find(row => row.programExerciseId === active.id)!;
    expect(rows.find(row => row.id === old.id)?.status).toBe('deprecated');
    expect(active.position).toBe(old.position);
    expect(active.exercise.exerciseDefinitionId).toBe('0002');
    expect(copy).toMatchObject({ plannedWeightKg: 65, plannedReps: 10, setLabel: 'warmup', comment: 'Старт' });
    expect(copy.id).not.toBe(oldSet.id);
    await expect(repo.programs.replaceDayExercise(programId, dayId, active.id, '0003', true))
      .rejects.toThrow('Типы учёта упражнений не совпадают');
    await repo.programs.replaceDayExercise(programId, dayId, active.id, '0003', false);
    const latest = (await db.table('programExercises').toArray()).find(row => row.status === 'active')!;
    const blank = (await db.table('programSets').toArray()).filter(row => row.programExerciseId === latest.id);
    expect(blank).toHaveLength(1);
    expect(blank[0]).toMatchObject({ plannedWeightKg: null, plannedReps: null, setType: null });
  });
});
