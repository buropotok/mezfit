import cloudConfig from '../../dexie-cloud.json';
import { cloudMembershipAdminToken } from './dexie-cloud-membership';
import { validatedPair } from './cloud-contact-profiles';
import { isWorkoutOccurrencePlan } from '../../src/data/cloud/workout-occurrence-plan';
import { validateScheduleTiming } from '../../src/data/cloud/workout-scheduling-time';

type Json = Record<string, unknown>;
const record = (value: unknown): value is Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const user = (value: unknown): value is string =>
  typeof value === 'string' && /^tg:[1-9][0-9]*$/.test(value);
const keyPattern = /^[A-Za-z0-9_-]{8,128}$/;

class ReservationError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}
function reject(status: number, code: string): never { throw new ReservationError(status, code); }

async function requestCloud(
  env: Env, bearer: string, path: string, init: RequestInit = {},
): Promise<unknown | null> {
  let response: Response;
  try {
    response = await fetch(cloudConfig.dbUrl + path, {
      ...init, headers: {
        authorization: 'Bearer ' + bearer,
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
    });
  } catch { return reject(502, 'CLOUD_BOOKING_UNAVAILABLE'); }
  if (response.status === 404 && !init.body) return null;
  if (!response.ok) return reject(502, 'CLOUD_BOOKING_UNAVAILABLE');
  if (init.method === 'POST') return { ok: true };
  try { return await response.json(); }
  catch { return reject(502, 'CLOUD_BOOKING_INVALID_RESPONSE'); }
}
async function getRow(env: Env, bearer: string, table: string, id: string): Promise<Json | null> {
  const value = await requestCloud(env, bearer, '/all/' + table + '/' + encodeURIComponent(id));
  if (value === null) return null;
  if (!record(value)) return reject(502, 'CLOUD_BOOKING_INVALID_RESPONSE');
  return value;
}
async function rows(env: Env, bearer: string, table: string, filters: Json): Promise<Json[]> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) query.set(key, String(value));
  const value = await requestCloud(env, bearer, '/all/' + table + '?' + query);
  if (!Array.isArray(value) || !value.every(record)) return reject(502, 'CLOUD_BOOKING_INVALID_RESPONSE');
  return value;
}
function conflict(a: Json, start: number, end: number): boolean {
  if (!['scheduled', 'in_progress'].includes(String(a.status))) return false;
  if (typeof a.startsAtUtc !== 'string' || !Number.isSafeInteger(a.durationMinutes)) {
    reject(502, 'CLOUD_BOOKING_INVALID_OCCURRENCE');
  }
  const from = Date.parse(a.startsAtUtc);
  return Number.isFinite(from) && start < from + (a.durationMinutes as number) * 60_000 && end > from;
}
function response(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}
function sameExercise(a: unknown, b: unknown): boolean {
  return record(a) && record(b)
    && a.exerciseDefinitionId === b.exerciseDefinitionId
    && a.scope === b.scope
    && a.name === b.name && a.nameEn === b.nameEn
    && a.mediaUrl === b.mediaUrl
    && JSON.stringify(a.catalogueDefinition ?? null) === JSON.stringify(b.catalogueDefinition ?? null)
    && a.catalogueCoachUserId === b.catalogueCoachUserId;
}

/** This operates only after Telegram authentication in the public Worker route. */
export async function confirmWorkoutOccurrence(
  env: Env, actor: string, input: unknown,
): Promise<Response> {
  if (!user(actor) || !record(input)
    || typeof input.requestKey !== 'string' || !keyPattern.test(input.requestKey)
    || typeof input.trainingPlanId !== 'string' || !input.trainingPlanId
    || typeof input.programDayId !== 'string' || !input.programDayId
    || (input.format !== 'coached' && input.format !== 'independent')
    || !isWorkoutOccurrencePlan(input.plan)
    || typeof input.startsAtUtc !== 'string'
    || !Number.isSafeInteger(input.durationMinutes)) reject(400, 'INVALID_SCHEDULE_REQUEST');
  try {
    validateScheduleTiming({
      startsAtUtc: input.startsAtUtc,
      durationMinutes: input.durationMinutes as number,
    });
  } catch { reject(400, 'INVALID_SCHEDULE_TIME'); }

  const token = await cloudMembershipAdminToken(env);
  const requestId = 'req:' + actor + ':' + input.requestKey;
  const existing = await rows(env, token, 'workoutOccurrences', { sourceRequestId: requestId });
  if (existing.length > 1) reject(502, 'CLOUD_BOOKING_INTEGRITY_ERROR');
  if (existing.length === 1) {
    const booking = existing[0];
    if (booking.createdByUserId !== actor
      || booking.trainingPlanId !== input.trainingPlanId
      || booking.programDayId !== input.programDayId
      || booking.format !== input.format || booking.startsAtUtc !== input.startsAtUtc
      || booking.durationMinutes !== input.durationMinutes
      || JSON.stringify(booking.plan) !== JSON.stringify(input.plan)) reject(409, 'SCHEDULE_KEY_CONFLICT');
    if (typeof booking.id !== 'string') reject(502, 'CLOUD_BOOKING_INVALID_RESPONSE');
    return response({ occurrenceId: booking.id, status: 'scheduled' });
  }

  const plan = await getRow(env, token, 'trainingPlans', input.trainingPlanId);
  if (!plan || plan.deletedAt || plan.id !== input.trainingPlanId
    || typeof plan.realmId !== 'string' || !plan.realmId
    || (plan.coachUserId !== null && !user(plan.coachUserId))
    || (plan.clientUserId !== null && !user(plan.clientUserId))
    || !user(plan.athleteUserId)
    || (plan.owner !== null && plan.owner !== (plan.coachUserId ?? plan.athleteUserId)))
    reject(404, 'SCHEDULE_PLAN_NOT_FOUND');
  const coach = plan.coachUserId as string | null;
  const athlete = plan.clientUserId === null ? plan.athleteUserId as string : plan.clientUserId as string;
  const personal = coach === null && plan.clientUserId === null
    && actor === athlete && plan.realmId === athlete;
  if (!personal) {
    if (!coach || !user(plan.clientUserId) || plan.athleteUserId !== plan.clientUserId
      || (actor !== coach && actor !== athlete)) reject(403, 'SCHEDULE_FORBIDDEN');
    if (actor === athlete && plan.status === 'draft') reject(403, 'SCHEDULE_PLAN_NOT_PUBLISHED');
    if (!await validatedPair(fetch, token, plan.realmId as string)) reject(403, 'SCHEDULE_FORBIDDEN');
  }
  if (input.format === 'coached' && (coach === null || actor !== coach))
    reject(403, 'SCHEDULE_COACH_REQUIRED');

  const day = await getRow(env, token, 'programDays', input.programDayId);
  if (!day || day.status !== 'active' || day.realmId !== plan.realmId
    || typeof day.programPhaseId !== 'string'
    || (day.owner !== null && day.owner !== (coach ?? athlete)))
    reject(404, 'SCHEDULE_DAY_NOT_FOUND');
  const phase = await getRow(env, token, 'programPhases', day.programPhaseId as string);
  if (!phase || phase.trainingPlanId !== plan.id || phase.realmId !== plan.realmId
    || phase.deletedAt || phase.status === 'cancelled'
    || (phase.owner !== null && phase.owner !== (coach ?? athlete))
    || (actor === athlete && !personal && phase.status === 'draft'))
    reject(404, 'SCHEDULE_DAY_NOT_FOUND');

  // Validate every incoming foreign key against the server's authoritative PLAN.
  const sourceExercises = await rows(env, token, 'programExercises', { programDayId: day.id });
  const byId = new Map(sourceExercises.filter(ex => ex.realmId === day.realmId
    && ex.status === 'active').map(ex => [ex.id, ex]));
  for (const exercise of input.plan.exercises) {
    if (exercise.sourceProgramExerciseId !== null) {
      const source = byId.get(exercise.sourceProgramExerciseId);
      if (!source || !sameExercise(source.exercise, exercise.exercise))
        reject(409, 'SCHEDULE_SOURCE_CHANGED');
    } else {
      const definitionId = exercise.exercise.exerciseDefinitionId;
      if (exercise.exercise.scope === 'public') {
        const definition = await getRow(env, token, 'publicExerciseDefinitions', definitionId);
        if (!definition || definition.realmId !== 'rlm-public') reject(403, 'SCHEDULE_EXERCISE_UNAVAILABLE');
      } else if (exercise.exercise.scope === 'coach' && actor === coach) {
        const definition = await getRow(env, token, 'coachExerciseDefinitions', definitionId);
        if (!definition || definition.realmId !== actor || definition.archivedAt !== null)
          reject(403, 'SCHEDULE_EXERCISE_UNAVAILABLE');
      } else reject(403, 'SCHEDULE_EXERCISE_UNAVAILABLE');
    }
    const sourceSetIds = exercise.sourceProgramExerciseId === null ? new Set<string>()
      : new Set((await rows(env, token, 'programSets', {
        programExerciseId: exercise.sourceProgramExerciseId,
      })).filter(set => set.realmId === day.realmId && set.status === 'active')
        .map(set => String(set.id)));
    if (exercise.sets.some(set => set.sourceProgramSetId !== null
      && !sourceSetIds.has(set.sourceProgramSetId))) reject(409, 'SCHEDULE_SOURCE_CHANGED');
  }

  const start = Date.parse(input.startsAtUtc);
  const end = start + (input.durationMinutes as number) * 60_000;
  const athleteBookings = await rows(env, token, 'workoutOccurrences', { athleteUserId: athlete });
  if (athleteBookings.some(row => conflict(row, start, end))) reject(409, 'SCHEDULE_SLOT_OCCUPIED');
  if (input.format === 'coached' && coach) {
    const coachBookings = await rows(env, token, 'workoutOccurrences', { coachUserId: coach });
    if (coachBookings.some(row => row.format === 'coached' && conflict(row, start, end)))
      reject(409, 'SCHEDULE_SLOT_OCCUPIED');
  }

  const now = new Date().toISOString();
  await requestCloud(env, token, '/all/workoutOccurrences', {
    method: 'POST',
    body: JSON.stringify([{
      realmId: plan.realmId, owner: null, trainingPlanId: plan.id,
      programDayId: day.id, athleteUserId: athlete, coachUserId: coach,
      clientUserId: plan.clientUserId, workoutSessionId: null,
      format: input.format, startsAtUtc: input.startsAtUtc,
      durationMinutes: input.durationMinutes, status: 'scheduled',
      sourceRequestId: requestId, createdByUserId: actor,
      createdAt: now, updatedAt: now, plan: input.plan,
    }]),
  });
  const stored = await rows(env, token, 'workoutOccurrences', { sourceRequestId: requestId });
  if (stored.length !== 1 || typeof stored[0].id !== 'string'
    || stored[0].status !== 'scheduled') reject(502, 'CLOUD_BOOKING_NOT_CONFIRMED');
  return response({ occurrenceId: stored[0].id, status: 'scheduled' }, 201);
}

/**
 * A single globally addressed Durable Object serializes all authoritative booking
 * confirmations. Never do a separate REST read-then-write without this queue.
 */
export class ScheduleReservationCoordinator {
  private queue: Promise<void> = Promise.resolve();

  constructor(_state: DurableObjectState, private readonly env: Env) {}

  fetch(request: Request): Promise<Response> {
    const run = this.queue.then(async () => {
      if (request.method !== 'POST') return response({ error: { code: 'METHOD_NOT_ALLOWED' } }, 405);
      try {
        const command: unknown = await request.json();
        if (!record(command) || !user(command.actor)) return reject(400, 'INVALID_ACTOR');
        return await confirmWorkoutOccurrence(this.env, command.actor, command.input);
      } catch (reason) {
        if (reason instanceof ReservationError)
          return response({ error: { code: reason.code, message: reason.code } }, reason.status);
        return response({ error: { code: 'BOOKING_FAILED', message: 'Не удалось сохранить тренировку' } }, 502);
      }
    });
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }
}
