import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import roles from '../../../cloud/roles.json';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import type { CloudTrainingPlanRow, MezfitCloudDatabase } from './database';
import type { CloudProgramDayRow, CloudProgramExerciseRow, CloudProgramSetRow } from './workout-foundation-types';
import { ProgramManagementRepository } from './program-management';

const databases: Dexie[] = [];
afterEach(async () => { for (const db of databases.splice(0)) await db.delete(); });

async function fixture(assigned = false) {
  const db = new Dexie(`program-days-${crypto.randomUUID()}`, { addons: [] });
  databases.push(db);
  db.version(1).stores({
    localProgramSync: 'id',
    trainingPlans: 'id, realmId, [realmId+status]',
    programPhases: 'id, realmId, trainingPlanId, [trainingPlanId+status], [realmId+status]',
    programDays: 'id, realmId, programPhaseId', programExercises: 'id, realmId, programDayId',
    programSets: 'id, realmId, programExerciseId', workoutSessions: 'id, trainingPlanId',
    realms: 'realmId', members: 'id, realmId', roles: '[realmId+name]',
  });
  for (const name of ['trainingPlans', 'programPhases', 'programDays', 'programExercises', 'programSets'])
    db.table(name).hook('creating', (key) => key === undefined ? crypto.randomUUID() : undefined);
  const pair = await relationshipMembership('101', '202');
  await db.table('realms').add(pair.realm);
  await db.table('members').bulkAdd(pair.members);
  await db.table('roles').add({ realmId: 'rlm-public', name: 'coach', ...roles.roles.coach });
  const plan: CloudTrainingPlanRow = {
    id: 'plan', realmId: assigned ? pair.realm.realmId : 'tg:101', owner: 'tg:101',
    athleteUserId: assigned ? 'tg:202' : 'tg:101', coachUserId: assigned ? 'tg:101' : null,
    clientUserId: assigned ? 'tg:202' : null, name: 'Программа', status: 'draft', position: 0,
    startedAt: null, finishedAt: null, createdAt: '', updatedAt: '',
  };
  await db.table('trainingPlans').add(plan);
  const database = db as unknown as MezfitCloudDatabase;
  const repo = new ProgramManagementRepository(database, 'tg:101');
  const phaseId = await repo.createPhase(plan.id, 'Фаза');
  return { db, plan, repo, phaseId, client: new ProgramManagementRepository(database, 'tg:202') };
}

async function seedExercise(db: Dexie, day: CloudProgramDayRow) {
  const exercise: CloudProgramExerciseRow = {
    id: 'exercise', realmId: day.realmId, owner: 'tg:101', programDayId: day.id, position: 0,
    status: 'active', notes: 'Плавное движение', exercise: {
      exerciseDefinitionId: 'catalogue-string-id', name: 'Жим', nameEn: null,
      scope: 'public', trackingType: 'weight_reps', mediaUrl: null,
    },
  };
  const set: CloudProgramSetRow = {
    id: 'set', realmId: day.realmId, owner: 'tg:101', programExerciseId: exercise.id,
    position: 0, status: 'active', setLabel: 'warmup', comment: 'Без рывков',
    materialLinks: ['https://example.com/material'], chatLinks: ['https://t.me/example/1'],
    plannedReps: null, plannedWeightKg: null, plannedDurationSeconds: null, plannedDistanceMeters: null,
  };
  await db.table('programExercises').add(exercise);
  await db.table('programSets').add(set);
}

describe('local-first program days', () => {
  it('creates the first phase atomically with personal and assigned programs', async () => {
    const { db, repo } = await fixture(true);
    for (const id of [await repo.createPersonal('Личная'), await repo.createAssigned('tg:202', 'Клиентская')]) {
      const plan = await db.table('trainingPlans').get(id);
      const phases = await db.table('programPhases').where('trainingPlanId').equals(id).toArray();
      expect(phases).toHaveLength(1);
      expect(phases[0]).toMatchObject({ name: 'Фаза 1', realmId: plan.realmId, owner: plan.owner,
        status: 'draft', position: 0, durationWeeks: 10 });
      expect(await db.table('localProgramSync').get(id)).toMatchObject({ revision: 1, confirmed: false });
    }
  });

  it('rolls back the new program when creating its first phase fails', async () => {
    const { db, repo } = await fixture();
    const before = await db.table('trainingPlans').count();
    db.table('programPhases').hook('creating', () => { throw new Error('NO_SPACE'); });
    await expect(repo.createPersonal('Не сохранится')).rejects.toThrow('NO_SPACE');
    expect(await db.table('trainingPlans').count()).toBe(before);
    expect((await db.table('trainingPlans').toArray()).some(row => row.name === 'Не сохранится')).toBe(false);
  });

  it('persists exact exercise order and rejects stale, duplicate, foreign and unauthorized lists', async () => {
    const { db, repo, client, phaseId } = await fixture(true);
    const dayId = await repo.createDay('plan', phaseId, 'День');
    const day = await db.table('programDays').get(dayId);
    await seedExercise(db, day);
    const first = await db.table('programExercises').get('exercise');
    await db.table('programExercises').add({ ...first, id: 'second', position: 1 });
    await repo.reorderDayExercises('plan', dayId, ['second', 'exercise']);
    const outline = (await repo.details('plan'))?.days?.find(row => row.day.id === dayId);
    expect(outline?.exercises.map(row => row.exercise.id)).toEqual(['second', 'exercise']);
    const revision = await db.table('localProgramSync').get('plan');
    for (const order of [['exercise'], ['exercise', 'exercise'], ['exercise', 'foreign']])
      await expect(repo.reorderDayExercises('plan', dayId, order)).rejects.toThrow();
    await expect(client.reorderDayExercises('plan', dayId, ['exercise', 'second'])).rejects.toThrow();
    expect(await db.table('localProgramSync').get('plan')).toEqual(revision);
    const unchanged = (await repo.details('plan'))?.days?.find(row => row.day.id === dayId);
    expect(unchanged?.exercises.map(row => row.exercise.id)).toEqual(['second', 'exercise']);
  });

  it('validates required names, appends after gaps and persists category/comment independently', async () => {
    const { db, repo, phaseId } = await fixture();
    await expect(repo.createDay('plan', phaseId, '  ')).rejects.toThrow();
    const first = await repo.createDay('plan', phaseId, '  День А  ');
    await db.table('programDays').update(first, { position: 8 });
    const second = await repo.createDay('plan', phaseId, 'День Б', ' силовая ');
    expect(await db.table('programDays').get(second)).toMatchObject({ position: 9, category: 'силовая' });
    expect(await db.table('programDays').get(first)).toMatchObject({ name: 'День А', category: null });
    await repo.commentDay('plan', second, ' Техника ');
    await repo.editDay('plan', second, 'Кардио', '');
    expect(await db.table('programDays').get(second)).toMatchObject({ name: 'Кардио', category: null, comment: 'Техника' });
    await expect(repo.editDay('plan', second, ' ', '')).rejects.toThrow();
    await expect(repo.createDay('plan', 'missing', 'День')).rejects.toThrow('Фаза не найдена');
    expect(await db.table('programDays').count()).toBe(2);
  });

  it('moves only within its phase, handles boundaries and preserves string identity', async () => {
    const { repo, phaseId } = await fixture();
    const a = await repo.createDay('plan', phaseId, 'А');
    const b = await repo.createDay('plan', phaseId, 'Б');
    const otherPhase = await repo.createPhase('plan');
    const c = await repo.createDay('plan', otherPhase, 'В');
    await repo.moveDay('plan', b, 'up');
    expect((await repo.details('plan'))?.days?.filter((row) => row.day.programPhaseId === phaseId)
      .map((row) => row.day.id)).toEqual([b, a]);
    expect((await repo.details('plan'))?.days?.some((row) => row.day.id === c)).toBe(true);
    await repo.moveDay('plan', b, 'up');
    await repo.moveDay('plan', a, 'down');
    expect((await repo.details('plan'))?.days?.filter((row) => row.day.programPhaseId === phaseId)
      .map((row) => row.day.id)).toEqual([b, a]);
  });

  it('copies day, phase and program trees with new IDs and retains recommendations', async () => {
    const { db, repo, phaseId } = await fixture();
    const id = await repo.createDay('plan', phaseId, 'Силовая', 'силовая');
    await seedExercise(db, await db.table('programDays').get(id));
    const copy = await repo.duplicateDay('plan', id);
    expect(copy).not.toBe(id);
    const copied = (await repo.details('plan'))?.days?.find((row) => row.day.id === copy);
    expect(copied?.exercises[0].exercise.id).not.toBe('exercise');
    expect(copied?.exercises[0].sets[0]).toMatchObject({ setLabel: 'warmup', comment: 'Без рывков',
      plannedReps: null, materialLinks: ['https://example.com/material'] });
    expect(copied?.exercises[0].sets[0].programExerciseId).toBe(copied?.exercises[0].exercise.id);
    await repo.duplicatePhase('plan', phaseId);
    expect((await repo.details('plan'))?.days).toHaveLength(4);
    const programCopy = await repo.duplicateProgram('plan');
    expect((await repo.details(programCopy))?.days).toHaveLength(4);
    expect((await repo.details(programCopy))?.phases.every((phase) => phase.status === 'draft')).toBe(true);
    expect(await db.table('workoutSessions').count()).toBe(0);
  });

  it('rolls back an entire tree copy when a child insert fails', async () => {
    const { db, repo, phaseId } = await fixture();
    const id = await repo.createDay('plan', phaseId, 'День');
    await seedExercise(db, await db.table('programDays').get(id));
    db.table('programSets').hook('creating', () => { throw new Error('Нет места'); });
    await expect(repo.duplicateProgram('plan')).rejects.toThrow('Нет места');
    expect(await db.table('trainingPlans').count()).toBe(1);
    expect(await db.table('programPhases').count()).toBe(1);
    expect(await db.table('programDays').count()).toBe(1);
    expect(await db.table('programExercises').count()).toBe(1);
  });

  it('tombstones PLAN without modifying history, including late children of a deleted phase', async () => {
    const { db, repo, phaseId } = await fixture();
    const id = await repo.createDay('plan', phaseId, 'День');
    const day: CloudProgramDayRow = await db.table('programDays').get(id);
    await seedExercise(db, day);
    await db.table('workoutSessions').add({ id: 'session', trainingPlanId: 'plan', status: 'completed' });
    const history = await db.table('workoutSessions').toArray();
    await repo.deleteDay('plan', id);
    expect((await repo.details('plan'))?.days).toEqual([]);
    expect(await db.table('programSets').count()).toBe(1);
    await repo.deletePhase('plan', phaseId);
    await db.table('programDays').add({ ...day, id: 'late-offline-day', status: 'active' });
    expect((await repo.details('plan'))?.phases).toEqual([]);
    expect((await repo.details('plan'))?.days).toEqual([]);
    await expect(repo.createDay('plan', phaseId, 'Не создавать')).rejects.toThrow();
    await repo.deleteProgram('plan');
    expect(await repo.listReadable()).toEqual([]);
    expect(await db.table('workoutSessions').toArray()).toEqual(history);
    expect(await db.table('programDays').count()).toBe(2);
  });

  it('enforces author/realm boundaries and requires deployed descendant ACL for assigned days', async () => {
    const { db, repo, client, phaseId, plan } = await fixture(true);
    await db.table('roles').clear();
    await expect(repo.createDay('plan', phaseId, 'День')).rejects.toThrow('обновить права');
    await db.table('roles').add({ realmId: 'rlm-public', name: 'coach', ...roles.roles.coach });
    const id = await repo.createDay('plan', phaseId, 'День');
    await repo.publishPhase('plan', phaseId);
    await db.table('trainingPlans').update('plan', { status: 'active' });
    expect((await client.athleteDetails('plan'))?.days).toHaveLength(1);
    for (const task of [
      () => client.createDay('plan', phaseId, 'Подмена'),
      () => client.editDay('plan', id, 'Подмена', ''), () => client.commentDay('plan', id, 'Подмена'),
      () => client.moveDay('plan', id, 'up'), () => client.duplicateDay('plan', id),
      () => client.deleteDay('plan', id),
    ]) await expect(task()).rejects.toThrow('Недостаточно прав');
    const draftPhase = await repo.createPhase('plan');
    await repo.createDay('plan', draftPhase, 'Скрытый день');
    expect((await client.athleteDetails('plan'))?.days).toHaveLength(1);
    await db.table('programDays').add({ id: 'foreign', programPhaseId: phaseId,
      realmId: 'another-realm', owner: 'tg:101', name: 'Чужой', status: 'active', position: 0 });
    await db.table('programDays').add({ id: 'forged-owner', programPhaseId: phaseId,
      realmId: plan.realmId, owner: 'tg:202', name: 'Подмена', status: 'active', position: 0 });
    expect((await repo.details('plan'))?.days).toHaveLength(2);
    await expect(repo.deleteDay('plan', 'foreign')).rejects.toThrow();
    await expect(repo.editDay('plan', 'forged-owner', 'Нельзя', '')).rejects.toThrow();
  });

  it('observes local day changes without a cloud transport', async () => {
    const { repo, phaseId } = await fixture();
    const next = vi.fn(), error = vi.fn();
    const subscription = repo.observeDetails('plan', next, error);
    try {
      await vi.waitFor(() => expect(next).toHaveBeenCalled());
      const id = await repo.createDay('plan', phaseId, 'А');
      await vi.waitFor(() => expect(next.mock.lastCall?.[0]?.days).toHaveLength(1));
      await repo.editDay('plan', id, 'Б', 'кардио');
      await vi.waitFor(() => expect(next.mock.lastCall?.[0]?.days[0].day.name).toBe('Б'));
      await repo.deleteDay('plan', id);
      await vi.waitFor(() => expect(next.mock.lastCall?.[0]?.days).toHaveLength(0));
      expect(error).not.toHaveBeenCalled();
    } finally { subscription.unsubscribe(); }
  });

  it('requires the exact Coach PLAN ACL, rejecting extra managed tables', async () => {
    const { db, repo, phaseId } = await fixture(true);
    await db.table('roles').put({
      realmId: 'rlm-public', name: 'coach', ...roles.roles.coach,
      permissions: {
        ...roles.roles.coach.permissions,
        manage: [...roles.roles.coach.permissions.manage, 'workoutSessions'],
      },
    });
    await expect(repo.createDay('plan', phaseId, 'Недопустимый ACL'))
      .rejects.toThrow('обновить права');
    expect(await db.table('programDays').count()).toBe(0);
  });

  it('keeps new shared PLAN descendants ownerless through copies', async () => {
    const { db, repo, phaseId, plan } = await fixture(true);
    expect((await db.table('programPhases').get(phaseId)).owner).toBeNull();
    const dayId = await repo.createDay('plan', phaseId, 'Силовая');
    const original = await db.table('programDays').get(dayId);
    expect(original.owner).toBeNull();
    await seedExercise(db, original);
    const copyId = await repo.duplicateDay('plan', dayId);
    const copied = (await repo.details('plan'))?.days?.find((item) => item.day.id === copyId);
    expect(copied?.day.owner).toBeNull();
    expect(copied?.exercises[0]?.exercise.owner).toBeNull();
    expect(copied?.exercises[0]?.sets[0]?.owner).toBeNull();

    await repo.duplicatePhase('plan', phaseId);
    const duplicatedPlanId = await repo.duplicateProgram('plan');
    expect((await db.table('trainingPlans').get(duplicatedPlanId)).owner).toBeNull();
    const phases = await db.table('programPhases').where('trainingPlanId')
      .equals(duplicatedPlanId).toArray();
    expect(phases.length).toBeGreaterThan(0);
    expect(phases.every((phase) => phase.realmId === plan.realmId && phase.owner === null)).toBe(true);
    const nextDetails = await repo.details(duplicatedPlanId);
    expect(nextDetails?.days?.length).toBeGreaterThan(0);
    expect(nextDetails?.days?.every((item) => item.day.owner === null
      && item.exercises.every((exercise) => exercise.exercise.owner === null
        && exercise.sets.every((set) => set.owner === null)))).toBe(true);
  });
});
