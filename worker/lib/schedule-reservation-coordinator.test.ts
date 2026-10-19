import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validatedPair } from './cloud-contact-profiles';
import { confirmWorkoutOccurrence } from './schedule-reservation-coordinator';
import type { PublicExercise } from '../../shared/exercise-types';

vi.mock('./dexie-cloud-membership', () => ({ cloudMembershipAdminToken: vi.fn(async () => 'test-token') }));
vi.mock('./cloud-contact-profiles', () => ({ validatedPair: vi.fn() }));
const realmId = 'rlm0123456789abcdef0123456789ab';
const access = { realmId, athleteUserId: 'tg:202', clientUserId: 'tg:202', coachUserId: 'tg:101' };
const plan = { name: 'Локальный PLAN', category: null, comment: null, exercises: [] };
const command = (patch: Record<string, unknown> = {}) => ({
  requestKey: 'local-draft-one', trainingPlanId: 'plan-1', programDayId: 'day-1', access,
  format: 'independent', startsAtUtc: '2026-10-19T08:00:00.000Z', durationMinutes: 60, plan, ...patch,
});
const definition: PublicExercise = {
  id: 'custom-1', name: 'Жим', name_ru: 'Жим', name_en: 'Press', category: '', subcategory: '',
  subcategory_ru: '', movement_type: '', equipment: '', body_part: '', target: '', muscle_group: '',
  muscles: { primary: [], secondary: [], stabilizers: [], emphasis: [] }, mobility_targets: [],
  secondary_muscles: [], media_id: '', image: '', gif_url: '', attribution: '', created_at: '',
  instructions: { en: '', ru: '' }, instruction_steps: { en: [], ru: [] }, source_consistency_issue: null,
  anatomy_evidence: { classification_family: '', basis: '', external_individual_match: false },
};
const customPlan = (author = 'tg:101') => ({ ...plan, exercises: [{
  id: 'local-ex', sourceProgramExerciseId: 'local-source-ex', position: 0, notes: null, sets: [],
  exercise: { exerciseDefinitionId: definition.id, scope: 'coach', name: 'Локальное название',
    nameEn: null, mediaUrl: null, catalogueCoachUserId: author, catalogueDefinition: definition },
}] });
let saved: Record<string, unknown>[];
let remoteDefinition: Record<string, unknown> | null;
const requests: string[] = [];
const writes: unknown[] = [];
const env = {} as Env;
beforeEach(() => {
  saved = []; requests.length = 0; writes.length = 0;
  remoteDefinition = { id: definition.id, owner: 'tg:101', realmId: 'tg:101', archivedAt: '2026-10-19', name: 'Облачное имя' };
  vi.mocked(validatedPair).mockResolvedValue([
    { userId: 'tg:101', roles: ['coach'] }, { userId: 'tg:202', roles: ['client'] },
  ]);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const parsed = new URL(url);
    const table = parsed.pathname.split('/').filter(Boolean).slice(1).join('/');
    requests.push(table + parsed.search);
    if (table === 'workoutOccurrences') {
      if (init?.method === 'POST') {
        const rows = JSON.parse(String(init.body)) as Record<string, unknown>[];
        writes.push(rows); saved.push(...rows.map(row => ({ ...row, id: 'woc-confirmed' })));
        return new Response(null, { status: 200 });
      }
      // No availability reads: only the immutable operation identity is queried.
      expect([...parsed.searchParams.keys()]).toEqual(['sourceRequestId']);
      return Response.json(saved.filter(row => row.sourceRequestId === parsed.searchParams.get('sourceRequestId')));
    }
    if (table === 'coachExerciseDefinitions/custom-1')
      return remoteDefinition ? Response.json(remoteDefinition) : new Response(null, { status: 404 });
    if (table.startsWith('publicExerciseDefinitions/'))
      return Response.json({ id: table.split('/')[1], realmId: 'rlm-public' });
    throw new Error('Unexpected business-state read: ' + table);
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('structural-only booking validation', () => {
  it('deduplicates a large PLAN and reads definitions concurrently with a bound', async () => {
    const backend = fetch;
    let active = 0, peak = 0;
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).includes('/publicExerciseDefinitions/')) {
        active++; peak = Math.max(peak, active);
        await Promise.resolve();
        active--;
      }
      return backend(url, init);
    }));
    const exercises = Array.from({ length: 100 }, (_, position) => ({
      id: 'ex-' + position, sourceProgramExerciseId: null, position, notes: null, sets: [],
      exercise: { exerciseDefinitionId: String(position % 7 + 1).padStart(4, '0'),
        scope: 'public', name: 'Упражнение', nameEn: null, mediaUrl: null },
    }));
    expect((await confirmWorkoutOccurrence(env, 'tg:202', command({ plan: { ...plan, exercises } }))).status).toBe(201);
    expect(requests.filter(path => path.startsWith('publicExerciseDefinitions/'))).toHaveLength(7);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(6);
    expect(saved[0].plan).toEqual({ ...plan, exercises });
  });

  it('accepts client-local PLAN even when no cloud template exists and preserves its payload', async () => {
    const input = command();
    expect((await confirmWorkoutOccurrence(env, 'tg:202', input)).status).toBe(201);
    expect(saved[0]).toMatchObject({ realmId, plan: input.plan, trainingPlanId: 'plan-1', programDayId: 'day-1' });
    expect(requests.every(path => path.startsWith('workoutOccurrences?') || path === 'workoutOccurrences')).toBe(true);
    expect((writes[0] as Record<string, unknown>[])[0]).not.toHaveProperty('id');
  });

  it('does not reject locally accepted bookings because cloud slots overlap', async () => {
    saved = [{ id: 'other', athleteUserId: 'tg:202', coachUserId: 'tg:101', format: 'coached',
      startsAtUtc: '2026-10-19T08:00:00.000Z', durationMinutes: 60, status: 'scheduled' }];
    expect((await confirmWorkoutOccurrence(env, 'tg:101', command({ format: 'coached' }))).status).toBe(201);
    expect(writes).toHaveLength(1);
  });

  it('checks immutable retry identity, not changed cloud PLAN, time or lifecycle status', async () => {
    const input = command();
    await confirmWorkoutOccurrence(env, 'tg:202', input);
    Object.assign(saved[0], { plan: { ...plan, name: 'Изменено позднее' },
      startsAtUtc: '2026-10-20T08:00:00.000Z', durationMinutes: 90, status: 'cancelled' });
    const retry = await confirmWorkoutOccurrence(env, 'tg:202', input);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ occurrenceId: 'woc-confirmed', confirmed: true });
    expect(writes).toHaveLength(1);
    await expect(confirmWorkoutOccurrence(env, 'tg:202', command({ durationMinutes: 120 })))
      .rejects.toMatchObject({ status: 409, code: 'SCHEDULE_KEY_CONFLICT' });
  });

  it('denies foreign actors and forged relationship participants', async () => {
    await expect(confirmWorkoutOccurrence(env, 'tg:303', command()))
      .rejects.toMatchObject({ status: 403, code: 'SCHEDULE_FORBIDDEN' });
    await expect(confirmWorkoutOccurrence(env, 'tg:101', command({ access: { ...access, athleteUserId: 'tg:303', clientUserId: 'tg:303' } })))
      .rejects.toMatchObject({ status: 403, code: 'SCHEDULE_FORBIDDEN' });
    vi.mocked(validatedPair).mockResolvedValue(null);
    await expect(confirmWorkoutOccurrence(env, 'tg:101', command()))
      .rejects.toMatchObject({ status: 403, code: 'SCHEDULE_FORBIDDEN' });
    expect(writes).toHaveLength(0);
  });

  it('permits only the authenticated athlete in a personal realm', async () => {
    const personal = { realmId: 'tg:202', athleteUserId: 'tg:202', coachUserId: null, clientUserId: null };
    await expect(confirmWorkoutOccurrence(env, 'tg:101', command({ access: personal })))
      .rejects.toMatchObject({ status: 403, code: 'SCHEDULE_FORBIDDEN' });
    expect((await confirmWorkoutOccurrence(env, 'tg:202', command({ access: personal }))).status).toBe(201);
  });

  it('reserves coached bookings for the relationship coach', async () => {
    await expect(confirmWorkoutOccurrence(env, 'tg:202', command({ format: 'coached' })))
      .rejects.toMatchObject({ status: 403, code: 'SCHEDULE_COACH_REQUIRED' });
    expect(writes).toHaveLength(0);
  });

  it('checks public exercise access without comparing local names or media', async () => {
    const input = command({ plan: { ...plan, exercises: [{
      id: 'local-public', sourceProgramExerciseId: null, position: 0, notes: null, sets: [],
      exercise: { exerciseDefinitionId: '0001', scope: 'public', name: 'Локальное имя',
        nameEn: null, mediaUrl: '/local-media' },
    }] } });
    expect((await confirmWorkoutOccurrence(env, 'tg:202', input)).status).toBe(201);
    expect(saved[0].plan).toEqual(input.plan);
  });

  it.each(['tg:101', 'tg:202'])('preserves accessible custom snapshots for actor %s despite cloud archive/metadata', async actor => {
    const input = command({ plan: customPlan() });
    expect((await confirmWorkoutOccurrence(env, actor, input)).status).toBe(201);
    expect(saved[0].plan).toEqual(input.plan);
  });

  it('accepts a complete authorized snapshot before the custom definition synchronizes', async () => {
    remoteDefinition = null;
    expect((await confirmWorkoutOccurrence(env, 'tg:101', command({ plan: customPlan() }))).status).toBe(201);
    expect(saved[0].plan).toEqual(customPlan());
  });

  it('rejects foreign exercise ownership and foreign snapshot attribution', async () => {
    remoteDefinition = { realmId: 'tg:303', owner: 'tg:303', id: definition.id };
    await expect(confirmWorkoutOccurrence(env, 'tg:101', command({ plan: customPlan() })))
      .rejects.toMatchObject({ status: 403, code: 'SCHEDULE_EXERCISE_UNAVAILABLE' });
    remoteDefinition = null;
    await expect(confirmWorkoutOccurrence(env, 'tg:101', command({ plan: customPlan('tg:303') })))
      .rejects.toMatchObject({ status: 403, code: 'SCHEDULE_EXERCISE_UNAVAILABLE' });
    expect(writes).toHaveLength(0);
  });

  it('validates payload format independently from business state', async () => {
    const malformed = customPlan();
    Reflect.deleteProperty(malformed.exercises[0].exercise, 'mediaUrl');
    await expect(confirmWorkoutOccurrence(env, 'tg:101', command({ plan: malformed })))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_SCHEDULE_REQUEST' });
    await expect(confirmWorkoutOccurrence(env, 'tg:101', command({ startsAtUtc: 'yesterday' })))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_SCHEDULE_TIME' });
    expect(writes).toHaveLength(0);
  });
});
