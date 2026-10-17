import { describe, expect, it, vi } from 'vitest';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import type { LocalProgramSyncRow, CloudTrainingPlanRow, MezfitCloudDatabase } from './database';
import type { CloudProgramDayRow, CloudProgramPhaseRow } from './workout-foundation-types';
import {
  ProgramManagementRepository, clientVisiblePhases, isCloudPlanRow, isCloudPhaseRow,
  isOtherActiveProgramInScope, selectedCoachActiveProgram,
} from './program-management';

const user = 'tg:101';
type Row = { id: string; realmId: string };
function mockTable<T extends Row>(initial: T[], prefix: string) {
  const data: T[] = initial.map((item) => ({ ...item }));
  let next = initial.length + 1;
  const read = async (key: string) => data.find((item) => item.id === key);
  return {
    data,
    get: vi.fn(read),
    toArray: vi.fn(async () => [...data]),
    where: (field: string | Record<string, unknown>) => {
      const collection = (matches: (row: T) => boolean) => ({
        toArray: async () => data.filter(matches),
        count: async () => data.filter(matches).length,
        modify: vi.fn(async (changes: Partial<T>) => {
          const affected = data.filter(matches);
          for (const row of affected) Object.assign(row, changes);
          return affected.length;
        }),
        delete: vi.fn(async () => {
          let deleted = 0;
          for (let i = data.length - 1; i >= 0; i--) {
            if (matches(data[i])) { data.splice(i, 1); deleted++; }
          }
          return deleted;
        }),
      });
      if (typeof field === 'string') {
        const compound = /^\[([^+]+)\+([^\]]+)\]$/.exec(field);
        return { equals: (value: string | readonly string[]) => collection((row) =>
          compound && Array.isArray(value)
            ? Reflect.get(row, compound[1]) === value[0] && Reflect.get(row, compound[2]) === value[1]
            : Reflect.get(row, field) === value) };
      }
      return collection((row) => Object.entries(field).every(([key, value]) =>
        Reflect.get(row, key) === value));
    },
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
  const syncRows = new Map<string, LocalProgramSyncRow>();
  const localProgramSync = {
    get: async (id: string) => syncRows.get(id),
    put: async (row: LocalProgramSyncRow) => { syncRows.set(row.id, row); },
  };
  const trainingPlans = mockTable<CloudTrainingPlanRow>([initial], 'tra');
  const programPhases = mockTable<CloudProgramPhaseRow>([], 'pha');
  const programDays = mockTable<CloudProgramDayRow>([], 'day');
  const programExercises = mockTable([], 'pex');
  const programSets = mockTable([], 'pst');
  const workoutSessions = mockTable([], 'ses');
  const workoutOccurrences = mockTable([], 'occ');
  const transaction = vi.fn(async (...args: unknown[]) => {
    const callback = args.at(-1);
    if (typeof callback !== 'function') throw new Error('Missing transaction callback');
    return callback();
  });
  const realms = mockTable<Row>([], 'realm');
  const members = mockTable<Row>([], 'member');
  const db = {
    localProgramSync, trainingPlans, programPhases, programDays, programExercises, programSets,
    workoutSessions, workoutOccurrences,
    realms, members,
    transaction,
  } as unknown as MezfitCloudDatabase;
  return {
    repo: new ProgramManagementRepository(db, user),
    plans: trainingPlans.data, phases: programPhases.data, days: programDays.data,
    transaction,
    db, realmRows: realms.data, memberRows: members.data,
  };
}

describe('local-first program/phase management', () => {
  it('lists personal programs and published assignments from every coach, never assigned drafts', async () => {
    const f = fixture();
    for (const coachId of ['101', '303']) {
      const pair = await relationshipMembership(coachId, '202');
      f.realmRows.push({ ...pair.realm, id: pair.realm.realmId });
      f.memberRows.push(...pair.members);
      const coach = new ProgramManagementRepository(f.db, `tg:${coachId}`);
      const assigned = await coach.createAssigned('tg:202', `Программа ${coachId}`);
      f.plans.find((plan) => plan.id === assigned)!.status = coachId === '101' ? 'active' : 'finished';
      await coach.createAssigned('tg:202', `Черновик ${coachId}`);
    }
    const client = new ProgramManagementRepository(f.db, 'tg:202');
    await client.createPersonal('Личная');
    expect((await client.listForAthlete()).map((plan) => plan.name).sort()).toEqual([
      'Личная', 'Программа 101', 'Программа 303',
    ]);
    const draft = f.plans.find((plan) => plan.name === 'Черновик 101')!;
    expect(await client.athleteDetails(draft.id)).toBeNull();
    const assigned = f.plans.find((plan) => plan.name === 'Программа 101')!;
    const hidden = await f.repo.createPhase(assigned.id);
    const published = await f.repo.createPhase(assigned.id);
    await f.repo.publishPhase(assigned.id, published);
    expect((await client.athleteDetails(assigned.id))?.phases.map((phase) => phase.id)).toEqual([published]);
    expect((await f.repo.details(assigned.id))?.phases.map((phase) => phase.id)).toContain(hidden);
  });
  it('creates assigned phases locally without calling a cloud sync transport', async () => {
    const f = fixture();
    const pair = await relationshipMembership('101', '202');
    f.realmRows.push({ ...pair.realm, id: pair.realm.realmId });
    f.memberRows.push(...pair.members);
    // There is no cloud transport in this database fixture.
    const assigned = await f.repo.createAssigned('tg:202', 'Без сети');
    const phaseId = await f.repo.createPhase(assigned);
    expect(f.plans.find((plan) => plan.id === assigned)?.owner).toBeNull();
    expect(f.phases.find((phase) => phase.id === phaseId)).toMatchObject({
      trainingPlanId: assigned, realmId: pair.realm.realmId, owner: null, status: 'draft',
      name: 'Фаза 2', position: 1,
    });
  });

  it('keeps a completed phase visible in the active assigned program', async () => {
    const f = fixture();
    const pair = await relationshipMembership('101', '202');
    f.realmRows.push({ ...pair.realm, id: pair.realm.realmId });
    f.memberRows.push(...pair.members);
    const assigned = await f.repo.createAssigned('tg:202', 'Назначенная');
    const initial = await f.repo.details(assigned);
    expect(initial?.phases).toHaveLength(1);
    const phase = initial?.phases[0].id;
    if (!phase) throw new Error('Expected automatically created first phase');
    await f.repo.activate(assigned, phase);
    await f.repo.setPhaseStatus(assigned, phase, 'finished');
    const client = new ProgramManagementRepository(f.db, 'tg:202');
    expect((await client.details(assigned))?.program.status).toBe('active');
    expect((await client.details(assigned))?.phases[0].status).toBe('finished');
  });

  it('can return the previous active phase to pending when activating another', async () => {
    const f = fixture();
    const first = await f.repo.createPhase('tra-1');
    const second = await f.repo.createPhase('tra-1');
    await f.repo.activate('tra-1', first);
    await f.repo.activate('tra-1', second, { previousPhaseStatus: 'pending' });
    expect(f.phases.find((phase) => phase.id === first)?.status).toBe('pending');
    expect(f.phases.find((phase) => phase.id === second)?.status).toBe('active');
  });
  it('rejects unsupported cloud statuses before they enter the domain', async () => {
    const f = fixture();
    expect(isCloudPlanRow({ ...f.plans[0], status: 'archived' })).toBe(false);
    const phaseId = await f.repo.createPhase('tra-1');
    expect(isCloudPhaseRow({ ...f.phases[0], status: 'archived' })).toBe(false);
    expect(isCloudPhaseRow({ ...f.phases[0], durationWeeks: -10 })).toBe(false);
    expect((await f.repo.details('tra-1'))?.phases[0].id).toBe(phaseId);
  });

  it('rejects forged PLAN ownership even when a relationship identifier matches', async () => {
    const f = fixture();
    f.plans[0].owner = 'tg:999';
    expect((await f.repo.listReadable()).length).toBe(0);
    await expect(f.repo.renameProgram('tra-1', 'Недоступно')).rejects.toThrow();
    f.plans[0].owner = user;
    const phaseId = await f.repo.createPhase('tra-1');
    f.phases[0].owner = 'tg:999';
    expect((await f.repo.details('tra-1'))?.phases).toHaveLength(0);
    expect(phaseId).toBeTruthy();
  });

  it('creates a personal plan for the athlete without inventing a client relationship', async () => {
    const f = fixture();
    const id = await f.repo.createPersonal('Новая программа');
    const row = f.plans.find((plan) => plan.id === id);
    expect(f.plans).toHaveLength(2);
    expect(row?.id).not.toBe('tra-1');
    expect(row).toMatchObject({
      owner: user, realmId: user, athleteUserId: user,
      coachUserId: null, clientUserId: null, status: 'draft',
    });
  });

  it.each(['personal', 'assigned'] as const)(
    'appends a new %s program after the maximum position when deletion leaves a gap', async (scope) => {
      const f = fixture();
      if (scope === 'assigned') {
        const pair = await relationshipMembership('101', '202');
        f.realmRows.push({ ...pair.realm, id: pair.realm.realmId });
        f.memberRows.push(...pair.members);
      }
      const create = (name: string) => scope === 'personal'
        ? f.repo.createPersonal(name) : f.repo.createAssigned('tg:202', name);
      const first = await create('Первая');
      const middle = await create('Средняя');
      const last = await create('Последняя');
      const lastPlan = f.plans.find((plan) => plan.id === last);
      if (!lastPlan) throw new Error('Expected last program');
      const lastPosition = lastPlan.position;
      await f.repo.deleteProgram(middle);
      // A different realm's order must not influence this allocation.
      f.plans.push({ ...f.plans[0], id: 'foreign', realmId: 'another-realm', position: 999 });
      const appended = await create('Новая');
      expect(f.plans.find((plan) => plan.id === appended)?.position).toBe(lastPosition + 1);
      expect(f.plans.find((plan) => plan.id === first)?.position).toBeLessThan(lastPosition);
      expect(f.transaction).toHaveBeenCalledWith('rw', ['trainingPlans', 'programPhases', 'localProgramSync'], expect.any(Function));
    },
  );

  it('creates a draft phase with ten weeks and publishes it while empty', async () => {
    const f = fixture();
    const id = await f.repo.createPhase('tra-1');
    expect(f.phases[0]).toMatchObject({
      id, owner: user, name: 'Фаза 1', status: 'draft', durationWeeks: 10,
    });
    await f.repo.publishPhase('tra-1', id);
    expect(f.phases[0].status).toBe('pending');
    expect(clientVisiblePhases(f.phases)).toHaveLength(1);
  });

  it('persists a named phase and rejects an empty explicit name', async () => {
    const f = fixture();
    const id = await f.repo.createPhase('tra-1', '  Силовая фаза  ');
    expect(f.phases.find((phase) => phase.id === id)?.name).toBe('Силовая фаза');
    await expect(f.repo.createPhase('tra-1', '  ')).rejects.toThrow();
    expect(f.phases).toHaveLength(1);
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

  it('replaces a prior active athlete program only after choosing its disposition', async () => {
    const f = fixture();
    const firstPhase = await f.repo.createPhase('tra-1');
    await f.repo.activate('tra-1', firstPhase);
    const secondPlan = await f.repo.createPersonal('Другая программа');
    const secondPhase = await f.repo.createPhase(secondPlan);
    await expect(f.repo.activate(secondPlan, secondPhase))
      .rejects.toThrow('PREVIOUS_PROGRAM_STATUS_REQUIRED');
    expect(f.plans[0].status).toBe('active');
    await f.repo.activate(secondPlan, secondPhase, { previousProgramStatus: 'finished' });
    expect(f.plans[0].status).toBe('finished');
    expect(f.phases.find((phase) => phase.id === firstPhase)?.status).toBe('finished');
    expect(f.plans.find((plan) => plan.id === secondPlan)?.status).toBe('active');
    expect(f.phases.find((phase) => phase.id === secondPhase)?.status).toBe('active');
  });

  it('requires assigned PLAN athlete identity to match the relationship client', () => {
    const personal = fixture().plans[0];
    const assigned: CloudTrainingPlanRow = {
      ...personal, id: 'assigned-valid', realmId: 'relationship-a',
      owner: 'tg:201', coachUserId: 'tg:201', clientUserId: user,
      athleteUserId: user,
    };
    expect(isCloudPlanRow(assigned)).toBe(true);
    // Older assigned headers intentionally do not have the newer identity field.
    expect(isCloudPlanRow({ ...assigned, athleteUserId: undefined })).toBe(true);
    expect(isCloudPlanRow({ ...assigned, athleteUserId: '' })).toBe(false);
    expect(isCloudPlanRow({ ...assigned, athleteUserId: 'tg:303' })).toBe(false);
    expect(isCloudPlanRow({ ...assigned, athleteUserId: 'tg:303', status: 'active' }))
      .toBe(false);
  });

  it('permits independent active programs from two coaches for the same athlete', () => {
    const base = fixture().plans[0];
    const coachA: CloudTrainingPlanRow = {
      ...base, id: 'assigned-a', realmId: 'relationship-a', athleteUserId: user,
      coachUserId: 'tg:201', clientUserId: user, status: 'active',
    };
    const coachB: CloudTrainingPlanRow = {
      ...coachA, id: 'assigned-b', realmId: 'relationship-b', coachUserId: 'tg:301',
    };
    const anotherA: CloudTrainingPlanRow = { ...coachA, id: 'assigned-a2', status: 'active' };
    expect(isOtherActiveProgramInScope(coachB, coachA)).toBe(false);
    expect(isOtherActiveProgramInScope(anotherA, coachA)).toBe(true);
    expect(isOtherActiveProgramInScope(base, coachA)).toBe(false);
    expect(selectedCoachActiveProgram([coachB, coachA], user, 'tg:201')?.id)
      .toBe('assigned-a');
    expect(selectedCoachActiveProgram([coachB, coachA], user, 'tg:301')?.id)
      .toBe('assigned-b');
    expect(selectedCoachActiveProgram([coachB, coachA], user, 'tg:999'))
      .toBeUndefined();
  });

  it('allows client-created personal PLAN updates without granting assigned PLAN writes', async () => {
    const f = fixture();
    const personal = await f.repo.createPersonal('Моя самостоятельная программа');
    await f.repo.renameProgram(personal, 'План клиента');
    const phase = await f.repo.createPhase(personal);
    await f.repo.publishPhase(personal, phase);
    expect(f.plans.find((plan) => plan.id === personal)?.name).toBe('План клиента');
    expect(f.phases.find((row) => row.id === phase)?.status).toBe('pending');
    const assigned: CloudTrainingPlanRow = {
      ...f.plans[0], id: 'assigned',
      realmId: 'unapproved-realm', coachUserId: 'tg:201', clientUserId: user,
    };
    f.plans.push(assigned);
    await expect(f.repo.renameProgram('assigned', 'Нельзя')).rejects.toThrow();
  });

  it('allows a real relationship coach to author while its accepted client only reads', async () => {
    const f = fixture();
    const pair = await relationshipMembership('101', '202');
    f.realmRows.push({ ...pair.realm, id: pair.realm.realmId });
    f.memberRows.push(...pair.members);
    const assigned = await f.repo.createAssigned('tg:202', 'Назначенная программа');
    const initial = await f.repo.details(assigned);
    expect(initial?.phases).toHaveLength(1);
    const phase = initial?.phases[0].id;
    if (!phase) throw new Error('Expected automatically created first phase');
    await f.repo.publishPhase(assigned, phase);
    const client = new ProgramManagementRepository(f.db, 'tg:202');
    expect((await client.details(assigned))?.phases[0].id).toBe(phase);
    const before = structuredClone({ plans: f.plans, phases: f.phases });
    for (const mutation of [
      () => client.renameProgram(assigned, 'Подмена'),
      () => client.renamePhase(assigned, phase, 'Подмена'),
      () => client.duration(assigned, phase, 12),
      () => client.createPhase(assigned),
      () => client.publishPhase(assigned, phase),
      () => client.activate(assigned, phase),
      () => client.setProgramStatus(assigned, 'finished'),
      () => client.setPhaseStatus(assigned, phase, 'cancelled'),
      () => client.duplicateProgram(assigned),
      () => client.duplicatePhase(assigned, phase),
      () => client.deleteProgram(assigned),
      () => client.deletePhase(assigned, phase),
    ]) await expect(mutation()).rejects.toThrow('Недостаточно прав');
    expect({ plans: f.plans, phases: f.phases }).toEqual(before);
    const unrelated = new ProgramManagementRepository(f.db, 'tg:303');
    expect(await unrelated.details(assigned)).toBeNull();
    expect(await unrelated.listReadable()).toEqual([]);
  });

  it('deactivating an active phase updates the program in the same transaction', async () => {
    const f = fixture();
    const phaseId = await f.repo.createPhase('tra-1');
    await f.repo.activate('tra-1', phaseId);
    await f.repo.setPhaseStatus('tra-1', phaseId, 'cancelled');
    expect(f.plans[0].status).toBe('cancelled');
    expect(f.phases[0].status).toBe('cancelled');
  });

  it('deactivates the program to draft when its active phase returns to pending', async () => {
    const f = fixture();
    const id = await f.repo.createPhase('tra-1');
    await f.repo.activate('tra-1', id);
    await f.repo.setPhaseStatus('tra-1', id, 'pending');
    expect(f.plans[0].status).toBe('draft');
    expect(f.phases[0].status).toBe('pending');
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
    expect(f.plans[1].id).not.toBe(f.plans[0].id);
    expect(f.phases).toHaveLength(2);
    expect(f.phases[1]).toMatchObject({
      owner: user, status: 'draft', name: 'Фаза 1', durationWeeks: 10,
    });
    expect(f.phases[1].trainingPlanId).toBe(f.plans[1].id);
  });

  it('keeps activation exclusive within the selected relationship realm', async () => {
    const f = fixture();
    const first = await f.repo.createPhase('tra-1');
    await f.repo.activate('tra-1', first);
    const second = await f.repo.createPersonal('Ещё одна');
    const secondPhase = await f.repo.createPhase(second);
    await f.repo.activate(second, secondPhase, { previousProgramStatus: 'finished' });
    expect(f.plans.filter((plan) => plan.realmId === user && plan.status === 'active'))
      .toHaveLength(1);
    expect(f.phases.filter((phase) => phase.realmId === user && phase.status === 'active'))
      .toHaveLength(1);
    expect(f.plans[0].status).toBe('finished');
    expect(f.phases.find((phase) => phase.id === first)?.status).toBe('finished');
  });

  it('copies a nonempty phase and tombstones its source without losing descendants', async () => {
    const f = fixture();
    const phase = await f.repo.createPhase('tra-1');
    const second = await f.repo.createPhase('tra-1');
    await f.repo.deletePhase('tra-1', phase);
    const dayId = await f.repo.createDay('tra-1', second, 'День 1');
    await f.repo.duplicatePhase('tra-1', second);
    expect(f.phases).toHaveLength(2);
    expect(f.days).toHaveLength(2);
    expect(f.days[1].programPhaseId).not.toBe(second);
    await f.repo.deletePhase('tra-1', second);
    expect(f.phases.find((row) => row.id === second)?.deletedAt).toBeTruthy();
    expect(f.days.find((row) => row.id === dayId)).toBeTruthy();
    expect((await f.repo.details('tra-1'))?.phases).toHaveLength(1);
    expect((await f.repo.details('tra-1'))?.days).toHaveLength(1);
  });

  it('retains an addon-owned day graph when removing its program from PLAN', async () => {
    const f = fixture();
    const phaseId = await f.repo.createPhase('tra-1');
    await f.repo.createDay('tra-1', phaseId, 'День');
    await f.repo.duplicateProgram('tra-1');
    expect(f.plans).toHaveLength(2);
    expect(f.days).toHaveLength(2);
    await f.repo.deleteProgram('tra-1');
    expect(f.plans.find((row) => row.id === 'tra-1')?.deletedAt).toBeTruthy();
    expect(await f.repo.details('tra-1')).toBeNull();
    expect(await f.repo.listPersonal()).toHaveLength(1);
    expect(f.days).toHaveLength(2);
    await expect(f.repo.createDay('tra-1', phaseId, 'Поздний день')).rejects.toThrow();
  });

  it.each(['createPhase', 'duplicatePhase', 'duplicateProgram', 'publishPhase', 'renamePhase', 'duration'] as const)(
    'rejects %s if the parent was deleted before its write transaction', async (operation) => {
      const f = fixture();
      const phase = await f.repo.createPhase('tra-1');
      f.transaction.mockImplementationOnce(async (...args: unknown[]) => {
        f.plans.splice(0);
        const callback = args.at(-1);
        if (typeof callback !== 'function') throw new Error('Missing transaction callback');
        return callback();
      });
      const tasks = {
        createPhase: () => f.repo.createPhase('tra-1'),
        duplicatePhase: () => f.repo.duplicatePhase('tra-1', phase),
        duplicateProgram: () => f.repo.duplicateProgram('tra-1'),
        publishPhase: () => f.repo.publishPhase('tra-1', phase),
        renamePhase: () => f.repo.renamePhase('tra-1', phase, 'Новое имя'),
        duration: () => f.repo.duration('tra-1', phase, 12),
      };
      await expect(tasks[operation]()).rejects.toThrow('Программа изменилась');
      expect(f.phases).toHaveLength(1);
      expect(f.phases[0]).toMatchObject({ name: 'Фаза 1', status: 'draft', durationWeeks: 10 });
    },
  );

  it('consistently deletes all matching phase headers together with a program', async () => {
    const f = fixture();
    await f.repo.createPhase('tra-1');
    await f.repo.createPhase('tra-1');
    await f.repo.deleteProgram('tra-1');
    expect(f.plans).toHaveLength(0);
    expect(f.phases).toHaveLength(0);
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
