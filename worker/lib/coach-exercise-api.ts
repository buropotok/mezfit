import {
  archiveExerciseForCoach,
  createExerciseForCoach,
  getExerciseForCoach,
  listExercisesForCoach,
  setExerciseFavouriteForCoach,
  updateExerciseForCoach,
  type ExerciseCategoryCode,
  type ExerciseEquipmentCode,
  type ExerciseSort,
  type TrackingType,
} from './exercises';

const trackingTypes = new Set<TrackingType>(['weight_reps', 'time', 'time_distance', 'time_reps', 'time_weight']);
const categoryCodes = new Set<ExerciseCategoryCode>(['chest', 'arms', 'back', 'legs', 'shoulders', 'core', 'full_body', 'cardio', 'other']);
const equipmentCodes = new Set<ExerciseEquipmentCode>(['bodyweight', 'barbell', 'dumbbell_single', 'dumbbell_pair', 'cable', 'machine', 'other']);
const sortModes = new Set<ExerciseSort>(['alphabetical', 'reference']);

interface ExerciseInput {
  name: string;
  description: string | null;
  trackingType: TrackingType;
  categoryCode: ExerciseCategoryCode;
  equipmentCode: ExerciseEquipmentCode;
}

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, headers });
}

function error(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, { status });
}

function parseCategory(value: string | null): ExerciseCategoryCode | '' | null {
  if (!value) return '';
  return categoryCodes.has(value as ExerciseCategoryCode) ? value as ExerciseCategoryCode : null;
}

function parseTracking(value: string | null): TrackingType | '' | null {
  if (!value) return '';
  return trackingTypes.has(value as TrackingType) ? value as TrackingType : null;
}

async function readExerciseInput(request: Request): Promise<ExerciseInput | Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json<Record<string, unknown>>();
  } catch {
    return error(400, 'INVALID_JSON', 'Request body must be valid JSON');
  }

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
  if (!name) return error(400, 'INVALID_NAME', 'Exercise name is required');

  if (typeof body.trackingType !== 'string' || !trackingTypes.has(body.trackingType as TrackingType)) {
    return error(400, 'INVALID_TRACKING_TYPE', 'Unsupported exercise tracking type');
  }
  if (typeof body.categoryCode !== 'string' || !categoryCodes.has(body.categoryCode as ExerciseCategoryCode)) {
    return error(400, 'INVALID_CATEGORY', 'Unsupported exercise category');
  }
  if (typeof body.equipmentCode !== 'string' || !equipmentCodes.has(body.equipmentCode as ExerciseEquipmentCode)) {
    return error(400, 'INVALID_EQUIPMENT', 'Unsupported exercise equipment');
  }

  return {
    name,
    description: typeof body.description === 'string' ? body.description.trim().slice(0, 500) || null : null,
    trackingType: body.trackingType as TrackingType,
    categoryCode: body.categoryCode as ExerciseCategoryCode,
    equipmentCode: body.equipmentCode as ExerciseEquipmentCode,
  };
}

export async function handleCoachExerciseCatalogueRoute(
  request: Request,
  db: D1Database,
  coachUserId: number,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/api/coach/exercises') {
    if (request.method === 'GET') {
      const categoryCode = parseCategory(url.searchParams.get('category'));
      if (categoryCode === null) return error(400, 'INVALID_CATEGORY', 'Unsupported exercise category');
      const trackingType = parseTracking(url.searchParams.get('trackingType'));
      if (trackingType === null) return error(400, 'INVALID_TRACKING_TYPE', 'Unsupported exercise tracking type');
      const sortValue = url.searchParams.get('sort') ?? 'alphabetical';
      if (!sortModes.has(sortValue as ExerciseSort)) return error(400, 'INVALID_SORT', 'Unsupported catalogue sort');

      const exercises = await listExercisesForCoach(db, coachUserId, {
        search: (url.searchParams.get('search') ?? '').trim().slice(0, 100),
        categoryCode,
        trackingType,
        favouritesOnly: url.searchParams.get('favourites') === '1',
        sort: sortValue as ExerciseSort,
      });
      return json({ exercises });
    }

    if (request.method === 'POST') {
      const input = await readExerciseInput(request);
      if (input instanceof Response) return input;
      const exercise = await createExerciseForCoach(db, coachUserId, input);
      if (!exercise) return error(409, 'EXERCISE_EXISTS', 'An exercise with this name already exists in your catalogue');
      return json({ exercise }, { status: 201 });
    }

    return error(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  }

  const favouriteMatch = path.match(/^\/api\/coach\/exercises\/(\d+)\/favourite$/);
  if (favouriteMatch) {
    if (request.method !== 'PUT') return error(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    let body: { favourite?: unknown } = {};
    try {
      body = await request.json<{ favourite?: unknown }>();
    } catch {
      return error(400, 'INVALID_JSON', 'Request body must be valid JSON');
    }
    if (typeof body.favourite !== 'boolean') return error(400, 'INVALID_FAVOURITE', 'Favourite must be boolean');
    const ok = await setExerciseFavouriteForCoach(db, coachUserId, Number(favouriteMatch[1]), body.favourite);
    return ok ? json({ ok: true }) : error(404, 'EXERCISE_NOT_FOUND', 'Exercise not found');
  }

  const itemMatch = path.match(/^\/api\/coach\/exercises\/(\d+)$/);
  if (!itemMatch) return error(404, 'NOT_FOUND', 'API route not found');
  const exerciseId = Number(itemMatch[1]);

  if (request.method === 'GET') {
    const exercise = await getExerciseForCoach(db, coachUserId, exerciseId);
    return exercise ? json({ exercise }) : error(404, 'EXERCISE_NOT_FOUND', 'Exercise not found');
  }

  if (request.method === 'PATCH') {
    const input = await readExerciseInput(request);
    if (input instanceof Response) return input;
    const result = await updateExerciseForCoach(db, coachUserId, exerciseId, input);
    if (result === 'forbidden') return error(403, 'EXERCISE_READ_ONLY', 'Bundled or another coach exercise cannot be edited');
    if (result === 'exists') return error(409, 'EXERCISE_EXISTS', 'An exercise with this name already exists in your catalogue');
    return json({ exercise: result });
  }

  if (request.method === 'DELETE') {
    const archived = await archiveExerciseForCoach(db, coachUserId, exerciseId);
    return archived ? json({ ok: true }) : error(403, 'EXERCISE_READ_ONLY', 'Bundled or another coach exercise cannot be removed');
  }

  return error(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
}
