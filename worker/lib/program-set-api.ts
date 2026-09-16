import { createProgramSet, getProgramExerciseOwner, type ProgramSetInput } from './program-set-create';

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

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return error(400, 'INVALID_JSON', 'Request body must be valid JSON');
  }

  const setNumber = body.setNumber;
  if (!Number.isInteger(setNumber) || (setNumber as number) <= 0) {
    return error(400, 'INVALID_SET_NUMBER', 'Set number must be a positive integer');
  }

  const input: ProgramSetInput = {
    setNumber: setNumber as number,
    weightKg: metric(body.weightKg) ?? null,
    reps: metric(body.reps) ?? null,
    durationSeconds: metric(body.durationSeconds) ?? null,
    distanceMeters: metric(body.distanceMeters) ?? null,
  };
  if (
    metric(body.weightKg) === undefined
    || metric(body.reps) === undefined
    || metric(body.durationSeconds) === undefined
    || metric(body.distanceMeters) === undefined
  ) {
    return error(400, 'INVALID_SET_METRICS', 'Set metrics must be non-negative numbers or null');
  }

  const set = await createProgramSet(db, programExerciseId, input);
  return json({ set }, { status: 201 });
}
