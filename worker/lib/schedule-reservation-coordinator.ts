import cloudConfig from '../../dexie-cloud.json';
import { cloudMembershipAdminToken } from './dexie-cloud-membership';
import { validatedPair } from './cloud-contact-profiles';
import { isWorkoutBookingAccess } from '../../shared/workout-booking-access';
import { isWorkoutOccurrencePlan } from '../../shared/workout-occurrence-plan';
import { validateScheduleTiming } from '../../shared/workout-scheduling-time';

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
function response(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}
/** Compare immutable submission identities, never the current mutable booking. */
async function requestHash(value: unknown): Promise<string> {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (record(item)) return Object.fromEntries(Object.keys(item).sort().map(key => [key, canonical(item[key])]));
    return item;
  };
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
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
    || !isWorkoutBookingAccess(input.access)
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
  const access = input.access;
  const coach = access.coachUserId;
  const athlete = access.athleteUserId;
  const personal = coach === null;
  if (personal) {
    if (access.realmId !== actor || athlete !== actor) reject(403, 'SCHEDULE_FORBIDDEN');
  } else {
    if (actor !== coach && actor !== athlete) reject(403, 'SCHEDULE_FORBIDDEN');
    const members = await validatedPair(fetch, token, access.realmId);
    if (!members?.some(member => member.userId === coach
      && Array.isArray(member.roles) && member.roles.includes('coach'))
      || !members.some(member => member.userId === athlete
        && Array.isArray(member.roles) && member.roles.includes('client')))
      reject(403, 'SCHEDULE_FORBIDDEN');
  }
  if (input.format === 'coached' && (coach === null || actor !== coach))
    reject(403, 'SCHEDULE_COACH_REQUIRED');

  const fingerprint = await requestHash(input);
  const requestId = 'req:' + actor + ':' + input.requestKey;
  const existing = await rows(env, token, 'workoutOccurrences', { sourceRequestId: requestId });
  if (existing.length > 1) reject(502, 'CLOUD_BOOKING_INTEGRITY_ERROR');
  if (existing.length === 1) {
    const booking = existing[0];
    if (booking.createdByUserId !== actor || booking.realmId !== access.realmId
      || booking.sourceRequestHash !== fingerprint) reject(409, 'SCHEDULE_KEY_CONFLICT');
    if (typeof booking.id !== 'string') reject(502, 'CLOUD_BOOKING_INVALID_RESPONSE');
    return response({ occurrenceId: booking.id, confirmed: true });
  }

  // Deduplicate by catalogue + ID, with at most six reads in flight.
  const definitions = new Map<string, Json | null>();
  const lookups = new Map<string, { table: string; id: string }>();
  for (const { exercise } of input.plan.exercises) {
    const table = exercise.scope === 'public' ? 'publicExerciseDefinitions'
      : exercise.scope === 'coach' ? 'coachExerciseDefinitions' : null;
    if (!table) reject(403, 'SCHEDULE_EXERCISE_UNAVAILABLE');
    lookups.set(table + ':' + exercise.exerciseDefinitionId, { table, id: exercise.exerciseDefinitionId });
  }
  const pending = [...lookups.entries()];
  for (let offset = 0; offset < pending.length; offset += 6) {
    await Promise.all(pending.slice(offset, offset + 6).map(async ([key, lookup]) => {
      definitions.set(key, await getRow(env, token, lookup.table, lookup.id));
    }));
  }

  // Source IDs are provenance. No reads of cloud program/day/phase/set state.
  for (const { exercise } of input.plan.exercises) {
    const definitionId = exercise.exerciseDefinitionId;
    if (exercise.scope === 'public') {
      const definition = definitions.get('publicExerciseDefinitions:' + definitionId);
      if (!definition || definition.realmId !== 'rlm-public' || exercise.catalogueDefinition !== undefined)
        reject(403, 'SCHEDULE_EXERCISE_UNAVAILABLE');
    } else if (exercise.scope === 'coach') {
      const author = coach ?? athlete;
      if (exercise.catalogueCoachUserId !== author || !exercise.catalogueDefinition)
        reject(403, 'SCHEDULE_EXERCISE_UNAVAILABLE');
      const definition = definitions.get('coachExerciseDefinitions:' + definitionId);
      // A complete author-attributed snapshot may arrive before its definition.
      // It grants no access to catalogue rows; known foreign ownership is denied.
      if (definition && (definition.realmId !== author || definition.owner !== author))
        reject(403, 'SCHEDULE_EXERCISE_UNAVAILABLE');
    } else reject(403, 'SCHEDULE_EXERCISE_UNAVAILABLE');
  }

  const now = new Date().toISOString();
  await requestCloud(env, token, '/all/workoutOccurrences', {
    method: 'POST',
    body: JSON.stringify([{
      realmId: access.realmId, owner: null, trainingPlanId: input.trainingPlanId,
      programDayId: input.programDayId, athleteUserId: athlete, coachUserId: coach,
      clientUserId: access.clientUserId, workoutSessionId: null,
      format: input.format, startsAtUtc: input.startsAtUtc,
      durationMinutes: input.durationMinutes, status: 'scheduled',
      sourceRequestId: requestId, sourceRequestHash: fingerprint, createdByUserId: actor,
      createdAt: now, updatedAt: now, plan: input.plan,
    }]),
  });
  const stored = await rows(env, token, 'workoutOccurrences', { sourceRequestId: requestId });
  if (stored.length !== 1 || typeof stored[0].id !== 'string'
    || stored[0].sourceRequestHash !== fingerprint || stored[0].createdByUserId !== actor) reject(502, 'CLOUD_BOOKING_NOT_CONFIRMED');
  return response({ occurrenceId: stored[0].id, confirmed: true }, 201);
}

/**
 * The Durable Object serializes idempotent create/readback only.
 * It never locks business state, searches for slots or revalidates cloud templates.
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
