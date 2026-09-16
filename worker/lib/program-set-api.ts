import {
  createProgramSet,
  getProgramExerciseOwner,
  type ProgramSetInput,
  type ProgramSetTrackingType,
} from './program-set-create';

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, headers });
}

function error(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, { status });
}

function metric(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return value;
}

function integerMetric(value: unknown): number | null | undefined {
  const parsed = metric(value);
  if (parsed === undefined || parsed === null) return parsed;
  return Number.isInteger(parsed) ? parsed : undefined;
}

function metricsMatchTrackingType(input: ProgramSetInput, trackingType: ProgramSetTrackingType): boolean {
  switch (trackingType) {
    case 'weight_reps':
      return input.durationSeconds === null && input.distanceMeters === null;
    case 'time':
      return input.weightKg === null && input.reps === null && input.distanceMeters === null;
    case 'time_distance':
      return input.weightKg === null && input.reps === null;
    case 'time_reps':
      return input.weightKg === null && input.distanceMeters === null;
    case 'time_weight':
      return input.reps === null && input.distanceMeters === null;
  }
}

export async function handleCoachProgramSetRoute(
  request: Request,
  db: D1Database,
  coachUserId: number,
  programExerciseId: number,
): Promise<Response> {
  if (request.method !== 'POST') return error(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');

  const owner = await getProgramExerciseOwner(db, programExerciseId);
  if (!owner || owner.coach_user_id !== coachUserId) {
    return error(404, 'PROGRAM_EXERCISE_NOT_FOUND', 'Program exercise not found');
  }
  if (owner.user_id !== coachUserId) {
    const relationship = await db.prepare(`
      SELECT 1 AS ok
      FROM coach_client
      WHERE coach_user_id = ? AND client_user_id = ? AND status = 'active'
    `).bind(coachUserId, owner.user_id).first<{ ok: number }>();
    if (!relationship) return error(404, 'PROGRAM_EXERCISE_NOT_FOUND', 'Program exercise not found');
  }

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return error(400, 'INVALID_JSON', 'Request body must be valid JSON');
  }
  if (typeof parsedBody !== 'object' || parsedBody === null || Array.isArray(parsedBody)) {
    return error(400, 'INVALID_JSON', 'Request body must be a JSON object');
  }
  const body = parsedBody as Record<string, unknown>;

  const setNumber = body.setNumber;
  if (!Number.isInteger(setNumber) || (setNumber as number) <= 0) {
    return error(400, 'INVALID_SET_NUMBER', 'Set number must be a positive integer');
  }

  const weightKg = metric(body.weightKg);
  const reps = integerMetric(body.reps);
  const durationSeconds = integerMetric(body.durationSeconds);
  const distanceMeters = metric(body.distanceMeters);
  if (weightKg === undefined || reps === undefined || durationSeconds === undefined || distanceMeters === undefined) {
    return error(400, 'INVALID_SET_METRICS', 'Set metrics must be non-negative values or null');
  }

  const input: ProgramSetInput = {
    setNumber: setNumber as number,
    weightKg,
    reps,
    durationSeconds,
    distanceMeters,
  };
  if (!metricsMatchTrackingType(input, owner.tracking_type)) {
    return error(400, 'INVALID_SET_METRICS', 'Set metrics do not match the exercise tracking type');
  }

  const set = await createProgramSet(db, programExerciseId, coachUserId, input);
  if (!set) return error(409, 'PROGRAM_SET_EXISTS', 'A set with this number already exists');
  return json({ set }, { status: 201 });
}
