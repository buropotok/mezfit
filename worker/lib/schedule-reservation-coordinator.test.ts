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
const writes: unknown[] = [];
const requests: string[] = [];

beforeEach(() => {
  saved = []; writes.splice(0); requests.splice(0);
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
      id: 'plan-1', realmId, owner: null, athleteUserId: 'tg:202',
      clientUserId: 'tg:202', coachUserId: 'tg:101', status: 'active', name: 'Программа',
    });
    if (table === 'programDays/day-1') return Response.json({
      id: 'day-1', realmId, owner: null, programPhaseId: 'phase-1',
      name: 'День 1', status: 'active', category: null, comment: null,
    });
    if (table === 'programPhases/phase-1') return Response.json({
      id: 'phase-1', realmId, owner: null, trainingPlanId: 'plan-1',
      status: 'active',
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
