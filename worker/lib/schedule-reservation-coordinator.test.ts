import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validatedPair } from './cloud-contact-profiles';
import { confirmWorkoutOccurrence } from './schedule-reservation-coordinator';

vi.mock('./dexie-cloud-membership', () => ({
  cloudMembershipAdminToken: vi.fn(async () => 'test-token'),
}));
vi.mock('./cloud-contact-profiles', () => ({
  validatedPair: vi.fn(),
}));

const plan = { name: 'День 1', category: null, comment: null, exercises: [] };
const command = (patch: Record<string, unknown> = {}) => ({
  requestKey: 'local-draft-one', trainingPlanId: 'plan-1', programDayId: 'day-1',
  format: 'independent', startsAtUtc: '2026-10-19T08:00:00.000Z',
  durationMinutes: 60, plan, ...patch,
});
const realmId = 'rlm0123456789abcdef0123456789ab';

let saved: Record<string, unknown>[];
let personalPlan: boolean;
let definitionRealm: string;
const writes: unknown[] = [];
const requests: string[] = [];

beforeEach(() => {
  saved = []; writes.splice(0); requests.splice(0);
  personalPlan = false; definitionRealm = 'tg:101';
  vi.mocked(validatedPair).mockResolvedValue([
    { userId: 'tg:101', roles: ['coach'] },
    { userId: 'tg:202', roles: ['client'] },
  ]);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const parsed = new URL(url);
    const table = parsed.pathname.split('/').filter(Boolean).slice(1).join('/');
    requests.push((init?.method ?? 'GET') + ' ' + table);
    if (init?.method === 'POST' && table === 'workoutOccurrences') {
      const rows = JSON.parse(String(init.body)) as Record<string, unknown>[];
      writes.push(rows);
      saved.push(...rows.map(row => ({ ...row, id: 'woc123456789abcdef0123456789' })));
      return new Response(null, { status: 200 });
    }
    if (table === 'trainingPlans/plan-1') return Response.json({
      id: 'plan-1', realmId: personalPlan ? 'tg:101' : realmId, owner: null,
      athleteUserId: personalPlan ? 'tg:101' : 'tg:202',
      clientUserId: personalPlan ? null : 'tg:202', coachUserId: personalPlan ? null : 'tg:101', status: 'active', name: 'Программа',
    });
    if (table === 'programDays/day-1') return Response.json({
      id: 'day-1', realmId: personalPlan ? 'tg:101' : realmId, owner: null, programPhaseId: 'phase-1',
      name: 'День 1', status: 'active', category: null, comment: null,
    });
    if (table === 'programPhases/phase-1') return Response.json({
      id: 'phase-1', realmId: personalPlan ? 'tg:101' : realmId, owner: null, trainingPlanId: 'plan-1',
      status: 'active',
    });
    if (table === 'coachExerciseDefinitions/custom-1') return Response.json({
      id: 'custom-1', realmId: definitionRealm, archivedAt: null,
    });
    if (table === 'programExercises' || table === 'programSets') return Response.json([]);
    if (table === 'workoutOccurrences') {
      let rows = saved;
      for (const [key, value] of parsed.searchParams) rows = rows.filter(row => row[key] === value);
      return Response.json(rows);
    }
    return new Response(null, { status: 404 });
  }));
});
afterEach(() => vi.unstubAllGlobals());
const env = {} as Env;

describe('trusted occurrence reservation', () => {
  it('creates the occurrence using server-assigned @id and returns it on safe retry', async () => {
    const first = await confirmWorkoutOccurrence(env, 'tg:202', command());
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ occurrenceId: 'woc123456789abcdef0123456789' });
    expect(writes).toHaveLength(1);
    expect((writes[0] as Record<string, unknown>[])[0]).not.toHaveProperty('id');
    const again = await confirmWorkoutOccurrence(env, 'tg:202', command());
    expect(again.status).toBe(200);
    expect(writes).toHaveLength(1);
  });

  it('blocks clients from altering their coach-owned source prescription', async () => {
    await expect(confirmWorkoutOccurrence(env, 'tg:202', command({
      plan: { ...plan, name: 'Подменённый план' },
    }))).rejects.toMatchObject({ status: 403, code: 'SCHEDULE_PLAN_EDIT_FORBIDDEN' });
    expect(writes).toHaveLength(0);
  });

  it('blocks foreign users without accepting forged program IDs', async () => {
    await expect(confirmWorkoutOccurrence(env, 'tg:303', command()))
      .rejects.toMatchObject({ status: 403, code: 'SCHEDULE_FORBIDDEN' });
    expect(writes).toHaveLength(0);
  });

  it.each([
    [{ userId: 'tg:101', roles: ['coach'] }, { userId: 'tg:303', roles: ['client'] }],
    [{ userId: 'tg:303', roles: ['coach'] }, { userId: 'tg:202', roles: ['client'] }],
    [{ userId: 'tg:202', roles: ['coach'] }, { userId: 'tg:101', roles: ['client'] }],
  ])('rejects program identities that do not match membership roles: %j / %j', async (coach, client) => {
    vi.mocked(validatedPair).mockResolvedValue([coach, client]);
    await expect(confirmWorkoutOccurrence(env, 'tg:101', command({ format: 'coached' })))
      .rejects.toMatchObject({ status: 403, code: 'SCHEDULE_FORBIDDEN' });
    expect(writes).toHaveLength(0);
    expect(requests).not.toContain('GET programDays/day-1');
  });

  it('rejects an invalid relationship realm before loading its day', async () => {
    vi.mocked(validatedPair).mockResolvedValue(null);
    await expect(confirmWorkoutOccurrence(env, 'tg:101', command()))
      .rejects.toMatchObject({ status: 403, code: 'SCHEDULE_FORBIDDEN' });
    expect(writes).toHaveLength(0);
    expect(requests).not.toContain('GET programDays/day-1');
  });

  it.each([false, true])('blocks personal/coached conflicts in either booking order: %s', async personal => {
    personalPlan = personal;
    saved = [{
      id: 'older', athleteUserId: personal ? 'tg:202' : 'tg:101',
      coachUserId: personal ? 'tg:101' : null,
      format: personal ? 'coached' : 'independent',
      startsAtUtc: '2026-10-19T08:30:00.000Z', durationMinutes: 60,
      status: 'scheduled', sourceRequestId: 'older-request',
    }];
    await expect(confirmWorkoutOccurrence(env, 'tg:101', command({
      format: personal ? 'independent' : 'coached',
    }))).rejects.toMatchObject({ status: 409, code: 'SCHEDULE_SLOT_OCCUPIED' });
    expect(writes).toHaveLength(0);
  });

  it.each(['tg:101', 'tg:303'])('checks ownership of a personal custom exercise: %s', async realm => {
    personalPlan = true; definitionRealm = realm;
    const request = command({ plan: { ...plan, exercises: [{
      id: 'new-exercise', sourceProgramExerciseId: null, position: 0, notes: null, sets: [],
      exercise: { exerciseDefinitionId: 'custom-1', scope: 'coach', name: 'Своё упражнение',
        nameEn: null, mediaUrl: null },
    }] } });
    if (realm === 'tg:101') {
      expect((await confirmWorkoutOccurrence(env, 'tg:101', request)).status).toBe(201);
      expect(writes).toHaveLength(1);
    } else {
      await expect(confirmWorkoutOccurrence(env, 'tg:101', request))
        .rejects.toMatchObject({ status: 403, code: 'SCHEDULE_EXERCISE_UNAVAILABLE' });
      expect(writes).toHaveLength(0);
    }
  });

  it('rejects overlapping confirmed client slots', async () => {
    saved = [{
      id: 'older', athleteUserId: 'tg:202', startsAtUtc: '2026-10-19T08:30:00.000Z',
      durationMinutes: 60, status: 'scheduled', sourceRequestId: 'older-request',
    }];
    await expect(confirmWorkoutOccurrence(env, 'tg:101', command({ format: 'coached' })))
      .rejects.toMatchObject({ status: 409, code: 'SCHEDULE_SLOT_OCCUPIED' });
    expect(writes).toHaveLength(0);
  });
});
