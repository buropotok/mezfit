import { addWorkoutExercises, listWorkoutExerciseOptions } from './workout-exercise-actions';
import type { ExerciseCategoryCode } from './exercises';
import {
  completeWorkoutSession,
  initializeWorkoutSession,
  reorderWorkoutExercises,
  saveWorkoutSet,
  startWorkoutSession,
  type ResistanceBandCode,
  type WorkoutMetrics,
  type WorkoutSetFactInput,
  type WorkoutSetLabel,
  type WorkoutStartInput,
} from './workout-sessions';

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, headers });
}

function errorResponse(status: number, code: string, message: string, extra?: Record<string, unknown>): Response {
  return jsonResponse({ error: { code, message }, ...extra }, { status });
}

async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value = await request.json() as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNullableNonNegativeNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

function isNullableNonNegativeInteger(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0);
}

function parseMetrics(value: unknown): WorkoutMetrics | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!isNullableNonNegativeNumber(raw.weightKg)) return null;
  if (!isNullableNonNegativeInteger(raw.reps)) return null;
  if (!isNullableNonNegativeInteger(raw.durationSeconds)) return null;
  if (!isNullableNonNegativeNumber(raw.distanceMeters)) return null;
  return {
    weightKg: raw.weightKg,
    reps: raw.reps,
    durationSeconds: raw.durationSeconds,
    distanceMeters: raw.distanceMeters,
  };
}

const setLabels = new Set<WorkoutSetLabel>(['warmup', 'easy', 'normal', 'hard', 'drop']);
const bandCodes = new Set<ResistanceBandCode>(['yellow', 'red', 'green', 'blue', 'purple', 'black']);
const exerciseCategoryCodes = new Set<ExerciseCategoryCode>(['chest', 'arms', 'back', 'legs', 'shoulders', 'core', 'full_body', 'cardio', 'other']);

function parseFact(value: unknown): WorkoutSetFactInput | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const metrics = parseMetrics(raw.metrics);
  if (!metrics) return null;

  if (raw.setLabel !== null && (typeof raw.setLabel !== 'string' || !setLabels.has(raw.setLabel as WorkoutSetLabel))) return null;
  if (raw.rpe !== null && (typeof raw.rpe !== 'number' || !Number.isInteger(raw.rpe) || raw.rpe < 1 || raw.rpe > 10)) return null;
  if (raw.comment !== null && typeof raw.comment !== 'string') return null;
  if (!Array.isArray(raw.bands)) return null;

  const bands: ResistanceBandCode[] = [];
  for (const band of raw.bands) {
    if (typeof band !== 'string' || !bandCodes.has(band as ResistanceBandCode)) return null;
    if (!bands.includes(band as ResistanceBandCode)) bands.push(band as ResistanceBandCode);
  }

  return {
    metrics,
    setLabel: raw.setLabel as WorkoutSetLabel | null,
    rpe: raw.rpe as number | null,
    comment: typeof raw.comment === 'string' ? raw.comment.trim().slice(0, 1000) || null : null,
    bands,
  };
}

function parseStartInput(body: Record<string, unknown>): WorkoutStartInput | null {
  if (body.type === 'own') return { type: 'own' };
  if (body.type === 'program' && isPositiveInteger(body.programDayId)) {
    return { type: 'program', programDayId: body.programDayId };
  }
  return null;
}

function parseExerciseDefinitionIds(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0 || !value.every(isPositiveInteger)) return null;
  const ids = value as number[];
  if (new Set(ids).size !== ids.length) return null;
  return ids;
}

export async function handleWorkoutSessionRoute(request: Request, db: D1Database, userId: number): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === '/api/workout-sessions/exercises') {
    if (request.method !== 'GET') return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    const category = url.searchParams.get('category');
    if (!category || !exerciseCategoryCodes.has(category as ExerciseCategoryCode)) {
      return errorResponse(400, 'INVALID_CATEGORY', 'Exercise category is invalid');
    }
    const exercises = await listWorkoutExerciseOptions(
      db,
      userId,
      category as ExerciseCategoryCode,
      url.searchParams.get('search') ?? '',
    );
    return jsonResponse({ exercises });
  }

  if (url.pathname === '/api/workout-sessions/initialize') {
    if (request.method !== 'POST') return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    const body = await readJsonObject(request);
    if (!body) return errorResponse(400, 'INVALID_JSON', 'Request body must be a JSON object');
    const requestedPlan = body.trainingPlanId ?? null;
    if (requestedPlan !== null && !isPositiveInteger(requestedPlan)) {
      return errorResponse(400, 'INVALID_PROGRAM', 'Training plan id is invalid');
    }

    const result = await initializeWorkoutSession(db, userId, requestedPlan as number | null);
    if (result.kind === 'program_not_found') return errorResponse(404, 'PROGRAM_NOT_FOUND', 'Active program not found');
    if (result.kind === 'program_selection_required') {
      return errorResponse(409, 'PROGRAM_SELECTION_REQUIRED', 'Multiple active programs require an explicit selection', { programs: result.programs });
    }
    return jsonResponse({ session: result.session }, { status: 201 });
  }

  const startMatch = url.pathname.match(/^\/api\/workout-sessions\/(\d+)\/start$/);
  if (startMatch) {
    if (request.method !== 'POST') return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    const body = await readJsonObject(request);
    if (!body) return errorResponse(400, 'INVALID_JSON', 'Request body must be a JSON object');
    const input = parseStartInput(body);
    if (!input) return errorResponse(400, 'INVALID_WORKOUT_TYPE', 'Workout type is invalid');

    const result = await startWorkoutSession(db, userId, Number(startMatch[1]), input);
    if (result.kind === 'not_found') return errorResponse(404, 'WORKOUT_NOT_FOUND', 'Workout session not found');
    if (result.kind === 'invalid_state') return errorResponse(409, 'WORKOUT_STATE_INVALID', 'Workout session cannot be started');
    if (result.kind === 'invalid_program_day') return errorResponse(409, 'PROGRAM_DAY_INVALID', 'Program day is no longer available');
    return jsonResponse({ session: result.session });
  }

  const addExerciseMatch = url.pathname.match(/^\/api\/workout-sessions\/(\d+)\/exercises$/);
  if (addExerciseMatch) {
    if (request.method !== 'POST') return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    const body = await readJsonObject(request);
    const exerciseDefinitionIds = body ? parseExerciseDefinitionIds(body.exerciseDefinitionIds) : null;
    if (!exerciseDefinitionIds) {
      return errorResponse(400, 'INVALID_EXERCISE', 'Exercise ids are invalid');
    }

    const result = await addWorkoutExercises(db, userId, Number(addExerciseMatch[1]), exerciseDefinitionIds);
    if (result.kind === 'not_found') return errorResponse(404, 'WORKOUT_NOT_FOUND', 'Workout session not found');
    if (result.kind === 'invalid_state') return errorResponse(409, 'WORKOUT_STATE_INVALID', 'Workout is not active');
    if (result.kind === 'exercise_not_found') return errorResponse(404, 'EXERCISE_NOT_FOUND', 'Exercise is not available');
    return jsonResponse({ session: result.session }, { status: 201 });
  }

  const setMatch = url.pathname.match(/^\/api\/workout-sessions\/(\d+)\/sets\/(\d+)$/);
  if (setMatch) {
    if (request.method !== 'PUT') return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    const body = await readJsonObject(request);
    if (!body) return errorResponse(400, 'INVALID_JSON', 'Request body must be a JSON object');
    const fact = parseFact(body.fact);
    if (!fact) return errorResponse(400, 'INVALID_SET_FACT', 'Set fact is invalid');

    const result = await saveWorkoutSet(db, userId, Number(setMatch[1]), Number(setMatch[2]), fact);
    if (result.kind === 'not_found') return errorResponse(404, 'SET_NOT_FOUND', 'Session set not found');
    if (result.kind === 'invalid_state') return errorResponse(409, 'WORKOUT_STATE_INVALID', 'Workout is not active');
    return jsonResponse({ session: result.session });
  }

  const reorderMatch = url.pathname.match(/^\/api\/workout-sessions\/(\d+)\/exercises\/reorder$/);
  if (reorderMatch) {
    if (request.method !== 'PUT') return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    const body = await readJsonObject(request);
    if (!body || !Array.isArray(body.sessionExerciseIds) || !body.sessionExerciseIds.every(isPositiveInteger)) {
      return errorResponse(400, 'INVALID_EXERCISE_ORDER', 'Exercise order is invalid');
    }

    const result = await reorderWorkoutExercises(db, userId, Number(reorderMatch[1]), body.sessionExerciseIds as number[]);
    if (result.kind === 'not_found') return errorResponse(404, 'WORKOUT_NOT_FOUND', 'Workout session not found');
    if (result.kind === 'invalid_state') return errorResponse(409, 'WORKOUT_STATE_INVALID', 'Workout is not active');
    if (result.kind === 'invalid_order') return errorResponse(400, 'INVALID_EXERCISE_ORDER', 'Exercise order must contain every session exercise exactly once');
    return jsonResponse({ session: result.session });
  }

  const completeMatch = url.pathname.match(/^\/api\/workout-sessions\/(\d+)\/complete$/);
  if (completeMatch) {
    if (request.method !== 'POST') return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    const result = await completeWorkoutSession(db, userId, Number(completeMatch[1]));
    if (result.kind === 'not_found') return errorResponse(404, 'WORKOUT_NOT_FOUND', 'Workout session not found');
    if (result.kind === 'invalid_state') return errorResponse(409, 'WORKOUT_STATE_INVALID', 'Workout is not active');
    return jsonResponse({ session: result.session });
  }

  return errorResponse(404, 'NOT_FOUND', 'Workout route not found');
}
