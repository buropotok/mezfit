import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import roles from '../../../cloud/roles.json';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import type { MezfitCloudDatabase } from './database';
import { ProgramManagementRepository } from './program-management';
import { isAssignedCoachExerciseSnapshot } from './workout-foundation-types';
import { programExerciseTracking } from './program-exercise-selection';
import type { PublicExerciseRow } from '../exercises/publicExerciseTypes';

const databases: Dexie[] = [];
afterEach(async () => { for (const db of databases.splice(0)) await db.delete(); });
const sha = 'a'.repeat(64);
const row = (id: string, movement_type = 'resistance'): PublicExerciseRow => ({
  id, realmId: 'rlm-public', owner: null, sourceSha256: sha,
  name: 'Press', name_ru: 'Жим', name_en: 'Press', category: 'chest',
  subcategory: 'chest', subcategory_ru: 'Грудь', movement_type,
  muscles: { primary: [], secondary: [], stabilizers: [], emphasis: [] },
  mobility_targets: [], equipment: 'barbell', body_part: 'chest', target: 'chest',
  muscle_group: 'chest', secondary_muscles: [], media_id: id, image: '', gif_url: '', attribution: '',
  created_at: '', instructions: { ru: '', en: '' }, instruction_steps: { ru: [], en: [] },
  source_consistency_issue: null,
  anatomy_evidence: { classification_family: '', basis: '', external_individual_match: false },
});
async function fixture(assigned = false) {
  const db = new Dexie(`program-exercises-${crypto.randomUUID()}`, { addons: [] });
  databases.push(db);
  db.version(1).stores({ trainingPlans: 'id, realmId', programPhases: 'id, realmId, trainingPlanId',
    programDays: 'id, realmId, programPhaseId', programExercises: 'id, realmId, programDayId',
    programSets: 'id, realmId, programExerciseId', realms: 'realmId', members: 'id, realmId',
    roles: '[realmId+name]', publicExerciseDefinitions: 'id', publicExerciseCatalogues: 'id',
    coachExerciseDefinitions: 'id' });
  for (const table of ['trainingPlans', 'programPhases', 'programDays', 'programExercises'])
    db.table(table).hook('creating', key => key === undefined ? crypto.randomUUID() : undefined);
  const pair = await relationshipMembership('101', '202');
  await db.table('realms').add(pair.realm);
  await db.table('members').bulkAdd(pair.members);
  await db.table('roles').add({ realmId: 'rlm-public', name: 'coach', ...roles.roles.coach });
  const repo = new ProgramManagementRepository(db as unknown as MezfitCloudDatabase, 'tg:101');
  let planId: string;
  if (assigned) {
    planId = 'assigned';
    await db.table('trainingPlans').add({ id: planId, realmId: pair.realm.realmId, owner: null,
      athleteUserId: 'tg:202', coachUserId: 'tg:101', clientUserId: 'tg:202', name: 'План',
      status: 'draft', position: 0, startedAt: null, finishedAt: null, createdAt: '', updatedAt: '' });
  } else planId = await repo.createPersonal('План');
  const phase = await repo.createPhase(planId, 'Фаза');
  const dayId = await repo.createDay(planId, phase, 'День');
  await db.table('publicExerciseCatalogues').add({ id: 'mezfit:exercise-catalogue',
    realmId: 'rlm-public', owner: null, sourceSha256: sha, schemaVersion: '2.0.0',
    catalogue: 'mezfit.exercise_catalog.ru_anatomy', exerciseCount: 1324, taxonomyCount: 69,
    subcategoryLabelsRu: {}, movementFamilyReferences: {}, metadata: {}, publishedAt: '2026-10-17' });
  await db.table('publicExerciseDefinitions').bulkAdd([row('0001'), row('0002', 'cardio'), row('0003', 'skill')]);
  return { db, repo, planId, dayId, pair };
}

describe('program exercise authoring', () => {
  it('applies approved defaults and never guesses an unknown movement kind', () => {
    expect(programExerciseTracking('resistance')).toBe('weight_reps');
    expect(programExerciseTracking('cardio')).toBe('time_distance');
    expect(programExerciseTracking('mobility')).toBe('time');
    expect(programExerciseTracking('skill')).toBeNull();
  });
  it('commits ordered exercises locally, without sets, and survives database reopen', async () => {
    const { db, repo, planId, dayId } = await fixture();
    await repo.addDayExercises(planId, dayId, [{ id: '0002' }, { id: '0001' }]);
    db.close(); await db.open();
    const detail = await repo.details(planId);
    const exercises = detail?.days?.[0].exercises;
    expect(exercises?.map(item => item.exercise.exercise.exerciseDefinitionId)).toEqual(['0002', '0001']);
    expect(exercises?.map(item => item.exercise.exercise.trackingType)).toEqual(['time_distance', 'weight_reps']);
    expect(exercises?.every(item => item.sets.length === 0)).toBe(true);
    expect(exercises?.every(item => item.exercise.realmId === 'tg:101' && item.exercise.owner === 'tg:101')).toBe(true);
  });
  it('rolls back the whole selection when a later record is missing or its type is unresolved', async () => {
    const { db, repo, planId, dayId } = await fixture();
    await expect(repo.addDayExercises(planId, dayId, [{ id: '0001' }, { id: '9999' }])).rejects.toThrow();
    expect(await db.table('programExercises').count()).toBe(0);
    await expect(repo.addDayExercises(planId, dayId, [{ id: '0001' }, { id: '0003' }])).rejects.toThrow('тип учёта');
    expect(await db.table('programExercises').count()).toBe(0);
    await repo.addDayExercises(planId, dayId, [{ id: '0003', trackingType: 'time_reps' }]);
    expect(await db.table('programExercises').count()).toBe(1);
  });
  it('makes private exercise snapshots accessible in the relationship, without owner privileges', async () => {
    const { db, repo, planId, dayId, pair } = await fixture(true);
    const customId = 'custom:11111111-1111-4111-8111-111111111111';
    await db.table('coachExerciseDefinitions').add({ ...row('0001'), id: customId,
      realmId: 'tg:101', owner: 'tg:101', sourceSha256: 'coach-custom', updatedAt: '', archivedAt: null });
    await repo.addDayExercises(planId, dayId, [{ id: customId }]);
    const saved = await db.table('programExercises').toArray();
    expect(saved[0]).toMatchObject({ realmId: pair.realm.realmId, owner: null, programDayId: dayId });
    expect(isAssignedCoachExerciseSnapshot(saved[0].exercise, 'tg:101')).toBe(true);
    await db.table('coachExerciseDefinitions').delete(customId);
    expect((await repo.details(planId))?.days?.[0].exercises[0].exercise.exercise.name).toBe('Жим');
  });
  it('rejects a client modifying assigned PLAN, foreign/deleted days, duplicate IDs and foreign private exercises', async () => {
    const { db, repo, planId, dayId } = await fixture(true);
    const client = new ProgramManagementRepository(db as unknown as MezfitCloudDatabase, 'tg:202');
    await expect(client.addDayExercises(planId, dayId, [{ id: '0001' }])).rejects.toThrow('прав');
    await expect(repo.addDayExercises(planId, 'missing', [{ id: '0001' }])).rejects.toThrow('День не найден');
    await expect(repo.addDayExercises(planId, dayId, [{ id: '0001' }, { id: '0001' }])).rejects.toThrow();
    const foreign = 'custom:22222222-2222-4222-8222-222222222222';
    await db.table('coachExerciseDefinitions').add({ ...row('0001'), id: foreign,
      realmId: 'tg:303', owner: 'tg:303', sourceSha256: 'coach-custom', updatedAt: '', archivedAt: null });
    await expect(repo.addDayExercises(planId, dayId, [{ id: foreign }])).rejects.toThrow('недоступно');
    await db.table('programDays').update(dayId, { status: 'deprecated' });
    await expect(repo.addDayExercises(planId, dayId, [{ id: '0001' }])).rejects.toThrow('День не найден');
    expect(await db.table('programExercises').count()).toBe(0);
  });
});
