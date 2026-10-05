import {
  cancelOccurrence,
  createScheduleOccurrence,
  dayDistance,
  listScheduleOccurrences,
  parseCalendarDay,
  rescheduleOccurrence,
  type ScheduleRole,
} from './schedule';

type AuthRole = 'coach' | 'client';

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, headers });
}

function errorResponse(status: number, code: string, message: string): Response {
  return jsonResponse({ error: { code, message } }, { status });
}

async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value = await request.json() as unknown;
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function parseTiming(body: Record<string, unknown>) {
  const date = typeof body.date === 'string' ? parseCalendarDay(body.date) : null;
  const startMinute = body.startMinute;
  const durationMinutes = body.durationMinutes;
  if (
    !date
    || typeof startMinute !== 'number'
    || !Number.isInteger(startMinute)
    || startMinute < 0
    || startMinute > 1439
    || typeof durationMinutes !== 'number'
    || !Number.isInteger(durationMinutes)
    || durationMinutes <= 0
    || startMinute + durationMinutes > 1440
  ) return null;

  return { date, startMinute, durationMinutes };
}

function hasRole(roles: readonly AuthRole[], role: ScheduleRole): boolean {
  return roles.includes(role);
}

export async function handleScheduleRoute(
  request: Request,
  db: D1Database,
  actorUserId: number,
  roles: readonly AuthRole[],
): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === '/api/schedule') {
    if (request.method !== 'GET') return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');

    const role = url.searchParams.get('role');
    if (role !== 'coach' && role !== 'client') {
      return errorResponse(400, 'INVALID_SCHEDULE_ROLE', 'Schedule role is invalid');
    }
    if (!hasRole(roles, role)) {
      return errorResponse(403, 'ROLE_REQUIRED', `${role} role is required`);
    }

    const from = parseCalendarDay(url.searchParams.get('from') ?? '');
    const to = parseCalendarDay(url.searchParams.get('to') ?? '');
    if (!from || !to || dayDistance(from, to) < 0 || dayDistance(from, to) > 366) {
      return errorResponse(400, 'INVALID_SCHEDULE_RANGE', 'Schedule range is invalid');
    }

    const occurrences = await listScheduleOccurrences(db, actorUserId, role, from.dateKey, to.dateKey);
    return jsonResponse({ occurrences });
  }

  if (url.pathname === '/api/schedule/occurrences') {
    if (request.method !== 'POST') return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    if (!hasRole(roles, 'coach')) return errorResponse(403, 'ROLE_REQUIRED', 'coach role is required');

    const body = await readJsonObject(request);
    if (!body) return errorResponse(400, 'INVALID_JSON', 'Request body must be a JSON object');
    if (!isPositiveInteger(body.clientUserId) || !isPositiveInteger(body.programDayId)) {
      return errorResponse(400, 'INVALID_SCHEDULE_TARGET', 'Schedule target is invalid');
    }
    const timing = parseTiming(body);
    if (!timing) return errorResponse(400, 'INVALID_SCHEDULE_TIME', 'Schedule time is invalid');

    const result = await createScheduleOccurrence(db, actorUserId, {
      clientUserId: body.clientUserId,
      programDayId: body.programDayId,
      day: timing.date,
      startMinute: timing.startMinute,
      durationMinutes: timing.durationMinutes,
    });
    if (result.kind === 'invalid_target') {
      return errorResponse(404, 'SCHEDULE_TARGET_NOT_FOUND', 'Program day is not available for this client');
    }
    return jsonResponse({ occurrence: result.occurrence }, { status: 201 });
  }

  const occurrenceMatch = url.pathname.match(/^\/api\/schedule\/occurrences\/(\d+)$/);
  if (occurrenceMatch) {
    if (!hasRole(roles, 'coach')) return errorResponse(403, 'ROLE_REQUIRED', 'coach role is required');
    const occurrenceId = Number(occurrenceMatch[1]);

    if (request.method === 'PATCH') {
      const body = await readJsonObject(request);
      if (!body) return errorResponse(400, 'INVALID_JSON', 'Request body must be a JSON object');
      const timing = parseTiming(body);
      if (!timing) return errorResponse(400, 'INVALID_SCHEDULE_TIME', 'Schedule time is invalid');

      const result = await rescheduleOccurrence(
        db,
        actorUserId,
        occurrenceId,
        timing.date,
        timing.startMinute,
        timing.durationMinutes,
      );
      if (result.kind === 'not_found') return errorResponse(404, 'SCHEDULE_OCCURRENCE_NOT_FOUND', 'Schedule occurrence not found');
      if (result.kind === 'locked') return errorResponse(409, 'SCHEDULE_OCCURRENCE_LOCKED', 'Started or completed occurrence cannot be rescheduled');
      return jsonResponse({ occurrence: result.occurrence });
    }

    if (request.method === 'DELETE') {
      const result = await cancelOccurrence(db, actorUserId, occurrenceId);
      if (result === 'not_found') return errorResponse(404, 'SCHEDULE_OCCURRENCE_NOT_FOUND', 'Schedule occurrence not found');
      if (result === 'locked') return errorResponse(409, 'SCHEDULE_OCCURRENCE_LOCKED', 'Started or completed occurrence cannot be cancelled');
      return jsonResponse({ ok: true });
    }

    return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  }

  return errorResponse(404, 'NOT_FOUND', 'Schedule route not found');
}
