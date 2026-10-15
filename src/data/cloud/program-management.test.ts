import { describe, expect, it, vi } from 'vitest';
import type { CloudTrainingPlanRow, MezfitCloudDatabase } from './database';
import type { CloudProgramPhaseRow } from './workout-foundation-types';
import { ProgramManagementRepository, clientVisiblePhases } from './program-management';

const user = 'tg:101';
type Row = { id: string; realmId: string };
function mockTable<T extends Row>(initial: T[], prefix: string) {
  const data: T[] = initial.map((item) => ({ ...item }));
  let next = 1;
  const read = async (key: string) => data.find((item) => item.id === key);
  return {
    data,
    get: vi.fn(read),
    toArray: vi.fn(async () => [...data]),
    where: (field: string) => ({
      equals: (value: string) => ({
        toArray: async () => data.filter((row) => Reflect.get(row, field) === value),
        count: async () => data.filter((row) => Reflect.get(row, field) === value).length,
      }),
    }),
    count: vi.fn(async () => data.length),
    add: vi.fn(async (partial: Omit<T, 'id'>) => {
      const id = `${prefix}-${next++}`;
      data.push({ ...partial, id } as T);
      return id;
    }),
    update: vi.fn(async (id: string, patch: Partial<T>) => {
      const row = await read(id);
      if (!row) return 0;
      Object.assign(row, patch);
      return 1;
    }),
    delete: vi.fn(async (id: string) => {
      const index = data.findIndex((row) => row.id === id);
      if (index >= 0) data.splice(index, 1);
    }),
    bulkDelete: vi.fn(async (ids: string[]) => {
      for (const id of ids) {
        const index = data.findIndex((row) => row.id === id);
        if (index >= 0) data.splice(index, 1);
      }
    }),
  };
}
function fixture() {
  const now = '2026-10-15T00:00:00.000Z';
  const initial: CloudTrainingPlanRow = {
    id: 'tra-1', realmId: user, owner: null, athleteUserId: user,
    coachUserId: null, clientUserId: null,
    name: 'Моя программа', position: 0, status: 'draft',
    startedAt: null, finishedAt: null, createdAt: now, updatedAt: now,
  };
  const trainingPlans = mockTable<CloudTrainingPlanRow>([initial], 'tra');
  const programPhases = mockTable<CloudProgramPhaseRow>([], 'pha');
  const programDays = mockTable([], 'day');
  const programExercises = mockTable([], 'pex');
  const programSets = mockTable([], 'pst');
  const workoutSessions = mockTable([], 'ses');
  const workoutOccurrences = mockTable([], 'occ');
  const db = {
    trainingPlans, programPhases, programDays, programExercises, programSets,
    workoutSessions, workoutOccurrences,
    realms: mockTable([], 'realm'), members: mockTable([], 'member'),
    transaction: vi.fn(async (...args: unknown[]) => {
      const callback = args.at(-1);
      if (typeof callback !== 'function') throw new Error('Missing transaction callback');
      return callback();
    }),
  } as unknown as MezfitCloudDatabase;
  return {
    repo: new ProgramManagementRepository(db, user),
    plans: trainingPlans.data, phases: programPhases.data,
    transaction: db.transaction,
  };
}

describe('local-first program/phase management', () => {
  it('creates a personal plan for the athlete without inventing a client relationship', async () => {
    const f = fixture();
    const id = await f.repo.createPersonal('Новая программа');
    const row = f.plans.find((plan) => plan.id === id);
    expect(row).toMatchObject({
      owner: null, realmId: user, athleteUserId: user,
      coachUserId: null, clientUserId: null, status: 'draft',
    });
  });

  it('creates a draft phase with ten weeks and publishes it while empty', async () => {
    const f = fixture();
    const id = await f.repo.createPhase('tra-1');
    expect(f.phases[0]).toMatchObject({
      id, name: 'Фаза 1', status: 'draft', durationWeeks: 10,
    });
    await f.repo.publishPhase('tra-1', id);
    expect(f.phases[0].status).toBe('pending');
    expect(clientVisiblePhases(f.phases)).toHaveLength(1);
  });

  it('intentionally permits activation of an empty phase until issue #424', async () => {
    const f = fixture();
    const phaseId = await f.repo.createPhase('tra-1');
    await f.repo.activate('tra-1', phaseId);
    expect(f.plans[0].status).toBe('active');
    expect(f.phases[0].status).toBe('active');
    expect(f.transaction).toHaveBeenCalled();
  });

  it('requires an explicit disposition before replacing an active phase', async () => {
    const f = fixture();
    const first = await f.repo.createPhase('tra-1');
    const second = await f.repo.createPhase('tra-1');
    await f.repo.activate('tra-1', first);
    await expect(f.repo.activate('tra-1', second))
      .rejects.toThrow('PREVIOUS_PHASE_STATUS_REQUIRED');
    expect(f.phases.find((phase) => phase.id === first)?.status).toBe('active');
    await f.repo.activate('tra-1', second, { previousPhaseStatus: 'finished' });
    expect(f.phases.find((phase) => phase.id === first)?.status).toBe('finished');
    expect(f.phases.find((phase) => phase.id === second)?.status).toBe('active');
  });

  it('deactivating an active phase updates the program in the same transaction', async () => {
    const f = fixture();
    const phaseId = await f.repo.createPhase('tra-1');
    await f.repo.activate('tra-1', phaseId);
    await f.repo.setPhaseStatus('tra-1', phaseId, 'cancelled');
    expect(f.plans[0].status).toBe('cancelled');
    expect(f.phases[0].status).toBe('cancelled');
  });

  it('hides only draft phases from the active athlete program', async () => {
    const f = fixture();
    const first = await f.repo.createPhase('tra-1');
    const second = await f.repo.createPhase('tra-1');
    await f.repo.publishPhase('tra-1', first);
    const visible = clientVisiblePhases(f.phases);
    expect(visible.map((phase) => phase.id)).toEqual([first]);
    expect(visible.some((phase) => phase.id === second)).toBe(false);
  });

  it('duplicates the phase structure as drafts, without copying active status', async () => {
    const f = fixture();
    const phase = await f.repo.createPhase('tra-1');
    await f.repo.publishPhase('tra-1', phase);
    await f.repo.duplicateProgram('tra-1');
    expect(f.plans).toHaveLength(2);
    expect(f.plans[1].status).toBe('draft');
    expect(f.phases).toHaveLength(2);
    expect(f.phases[1]).toMatchObject({ status: 'draft', name: 'Фаза 1', durationWeeks: 10 });
    expect(f.phases[1].trainingPlanId).toBe(f.plans[1].id);
  });

  it('rejects invalid duration values', async () => {
    const f = fixture();
    const id = await f.repo.createPhase('tra-1');
    await expect(f.repo.duration('tra-1', id, 0)).rejects.toThrow();
    await expect(f.repo.duration('tra-1', id, 1.5)).rejects.toThrow();
    await f.repo.duration('tra-1', id, 12);
    expect(f.phases[0].durationWeeks).toBe(12);
  });
});
