import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MezfitCloudDatabase } from './database';
import { WorkoutPlanningRepository } from './workout-planning';
import { snapshotProgramDay } from './workout-occurrence-plan';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';

let db: Dexie;
let planner: WorkoutPlanningRepository;
beforeEach(() => {
  db = new Dexie('quick-workouts-' + crypto.randomUUID());
  db.version(1).stores({
    trainingPlans: 'id, realmId', programPhases: 'id, trainingPlanId',
    programDays: 'id, realmId, programPhaseId', programExercises: 'id, realmId, programDayId',
    programSets: 'id, realmId, programExerciseId', workoutOccurrences: 'id, realmId',
    localProgramSync: 'id', localWorkoutSync: 'id', realms: 'realmId', members: 'id, realmId', roles: 'name',
  });
  for (const name of ['trainingPlans', 'programPhases', 'programDays', 'programExercises', 'programSets', 'workoutOccurrences']) {
    db.table(name).hook('creating', (key, row) => {
      if (!key) { row.id = crypto.randomUUID(); return row.id; }
    });
  }
  planner = new WorkoutPlanningRepository(db as unknown as MezfitCloudDatabase, 'tg:101');
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
});
afterEach(async () => { await db.delete(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function fill(id: string) {
  await planner.drafts.enqueueEdit(id, draft => ({ ...draft, plan: { ...draft.plan,
    exercises: [{ id: 'local-exercise', sourceProgramExerciseId: null, position: 0, notes: 'Техника',
      exercise: { exerciseDefinitionId: '0001', name: 'Жим', nameEn: null, mediaUrl: null, scope: 'public' },
      sets: [{ id: 'local-set', sourceProgramSetId: null, position: 0, setLabel: 'normal', comment: 'Комментарий',
        materialLinks: ['https://example.org/material'], chatLinks: [], plannedReps: 12, plannedWeightKg: 40,
        plannedDurationSeconds: null, plannedDistanceMeters: null }] }],
  } }));
}
async function relationship(client = '202') {
  const pair = await relationshipMembership('101', client);
  await db.table('realms').put(pair.realm); await db.table('members').bulkPut(pair.members);
  await db.table('roles').put({ name: 'coach', realmId: 'rlm-public', permissions: {
    manage: ['trainingPlans', 'programPhases', 'programDays', 'programExercises', 'programSets'],
  } });
  return pair;
}

describe('quick workout planning', () => {
  it('creates the first real program and fills its day on first publication, without HTTP', async () => {
    const created = await planner.createBlank('tg:101', 'independent');
    expect(created.createdProgram).toBe(true);
    const initial = await planner.drafts.get(created.id);
    expect(initial?.autoCreatedProgram).toBe(true);
    expect(initial?.plan.exercises).toEqual([]);
    await fill(created.id);
    await planner.publish(created.id);
    const saved = await planner.drafts.get(created.id);
    const details = await planner.programs.details(saved!.trainingPlanId!);
    expect(details?.program.status).toBe('draft');
    expect(details?.phases[0].status).toBe('draft');
    expect(details?.days?.[0].exercises[0].sets[0]).toMatchObject({
      plannedReps: null, plannedWeightKg: null, comment: 'Комментарий', materialLinks: ['https://example.org/material'],
    });
    expect(saved?.plan.exercises[0].sets[0].plannedReps).toBe(12);
    expect(saved?.saved).toBe(true);
    await planner.drafts.replacePlan(created.id, { ...saved!.plan, name: 'Только эта тренировка' });
    await planner.publish(created.id);
    expect((await planner.programs.details(saved!.trainingPlanId!))?.days?.[0].day.name).toBe('Тренировка');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('creates an unlinked empty booking when a program already exists and reopens it offline', async () => {
    await planner.programs.createPersonal('Уже есть');
    const result = await planner.createBlank('tg:101', 'independent');
    expect(result.createdProgram).toBe(false);
    await planner.publish(result.id);
    db.close(); await db.open();
    planner = new WorkoutPlanningRepository(db as unknown as MezfitCloudDatabase, 'tg:101');
    expect(await planner.drafts.get(result.id)).toMatchObject({ saved: true, plan: { name: 'Тренировка', exercises: [] } });
    const row = await db.table('workoutOccurrences').get(result.id.slice(6));
    expect(row.programDayId).toBeUndefined(); expect(row.trainingPlanId).toBeUndefined();
    expect(await db.table('trainingPlans').count()).toBe(1);
    expect(await planner.drafts.list()).toEqual([]);
  });

  it('rolls back the entire first-program graph when booking insertion fails', async () => {
    const fail = () => { throw new Error('Нет места'); };
    db.table('workoutOccurrences').hook('creating', fail);
    await expect(planner.createBlank('tg:101', 'independent')).rejects.toThrow('Нет места');
    expect(await db.table('trainingPlans').count()).toBe(0);
    expect(await db.table('programPhases').count()).toBe(0);
    expect(await db.table('programDays').count()).toBe(0);
    expect(await db.table('localProgramSync').count()).toBe(0);
  });

  it.each(['independent', 'coached'] as const)('creates a first %s client workout in the approved relationship realm', async format => {
    const pair = await relationship();
    const created = await planner.createBlank('tg:202', format);
    expect(created.createdProgram).toBe(true);
    expect(await planner.drafts.get(created.id)).toMatchObject({ realmId: pair.realm.realmId,
      athleteUserId: 'tg:202', coachUserId: 'tg:101', format });
    const client = new WorkoutPlanningRepository(db as unknown as MezfitCloudDatabase, 'tg:202');
    expect(await client.drafts.list()).toEqual([]);
    await planner.publish(created.id);
    expect((await client.programs.listForScheduling('tg:202'))).toEqual([]);
  });

  it('rejects a foreign client without leaving a program or occurrence', async () => {
    await expect(planner.createBlank('tg:999', 'independent')).rejects.toThrow('Нет доступа');
    expect(await db.table('trainingPlans').count()).toBe(0);
    expect(await db.table('workoutOccurrences').count()).toBe(0);
  });

  it('does not create duplicate first programs when creation is repeated concurrently', async () => {
    await Promise.allSettled([planner.createBlank('tg:101', 'independent'), planner.createBlank('tg:101', 'independent')]);
    expect(await db.table('trainingPlans').count()).toBe(1);
    expect(await db.table('programDays').count()).toBe(1);
  });

  it('copies to a new day, rejects a stale replacement, and never changes the occurrence', async () => {
    const programId = await planner.programs.createPersonal('Цель');
    const details = await planner.programs.details(programId);
    const phaseId = details!.phases[0].id;
    const created = await planner.createBlank('tg:101', 'independent');
    await fill(created.id);
    const before = await db.table('workoutOccurrences').get(created.id.slice(6));
    const dayId = await planner.addToProgram(created.id, { programId, phaseId, name: 'Новый день' });
    const after = await planner.programs.details(programId);
    const day = after!.days!.find(row => row.day.id === dayId)!;
    expect(day.exercises[0].exercise.id).not.toBe('local-exercise');
    expect(day.exercises[0].sets[0].id).not.toBe('local-set');
    expect(day.exercises[0].sets[0].plannedReps).toBeNull();
    expect(await db.table('workoutOccurrences').get(before.id)).toEqual(before);
    const expected = snapshotProgramDay(day);
    await planner.programs.commentDay(programId, dayId, 'Новое изменение с другого устройства');
    await expect(planner.addToProgram(created.id, { programId, phaseId, dayId, name: 'Замена', expected })).rejects.toThrow('уже изменился');
    expect((await planner.programs.details(programId))!.days!.find(row => row.day.id === dayId)!.day.comment)
      .toBe('Новое изменение с другого устройства');
    expect(await db.table('workoutOccurrences').get(before.id)).toEqual(before);
    const latest = (await planner.programs.details(programId))!.days!.find(row => row.day.id === dayId)!;
    await planner.addToProgram(created.id, { programId, phaseId, dayId, name: 'Обновлённый день', expected: snapshotProgramDay(latest) });
    const replaced = (await planner.programs.details(programId))!.days!.find(row => row.day.id === dayId)!;
    expect(replaced.day.name).toBe('Обновлённый день');
    expect(replaced.exercises).toHaveLength(1);
    expect(replaced.exercises[0].sets[0].plannedWeightKg).toBeNull();
    expect(await db.table('workoutOccurrences').get(before.id)).toEqual(before);
  });

  it('does not allow saving one client workout into another client program', async () => {
    await relationship('202'); await relationship('303');
    const created = await planner.createBlank('tg:202', 'independent');
    const programId = await planner.programs.createAssigned('tg:303', 'Другой клиент');
    const phaseId = (await planner.programs.details(programId))!.phases[0].id;
    await expect(planner.addToProgram(created.id, { programId, phaseId, name: 'Ошибка' })).rejects.toThrow('этого атлета');
  });
});
