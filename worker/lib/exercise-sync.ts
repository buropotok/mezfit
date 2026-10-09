import {
  listExercisesForCoach,
  type ExerciseCategoryCode,
  type ExerciseDefinitionRow,
  type ExerciseEquipmentCode,
  type TrackingType,
} from './exercises';

const trackingTypes = new Set<TrackingType>([
  'weight_reps',
  'time',
  'time_distance',
  'time_reps',
  'time_weight',
]);
const categoryCodes = new Set<ExerciseCategoryCode>([
  'chest',
  'arms',
  'back',
  'legs',
  'shoulders',
  'core',
  'full_body',
  'cardio',
  'other',
]);
const equipmentCodes = new Set<ExerciseEquipmentCode>([
  'bodyweight',
  'barbell',
  'dumbbell_single',
  'dumbbell_pair',
  'cable',
  'machine',
  'other',
]);

export interface ExerciseCoachSyncOverride {
  exerciseSyncId: string;
  name: string;
  description: string | null;
  trackingType: TrackingType;
  categoryCode: ExerciseCategoryCode;
  equipmentCode: ExerciseEquipmentCode;
}

export interface ExerciseCoachSyncDefinition {
  syncId: string;
  name: string;
  description: string | null;
  trackingType: TrackingType;
  categoryCode: ExerciseCategoryCode;
  equipmentCode: ExerciseEquipmentCode;
}

export interface ExerciseCoachSyncSnapshot {
  definitions: ExerciseCoachSyncDefinition[];
  overrides: ExerciseCoachSyncOverride[];
  favourites: string[];
}

export interface ExerciseCoachSyncRequest {
  requestId: string;
  baseServerRevision: number;
  snapshot: ExerciseCoachSyncSnapshot;
}

export interface ExerciseCoachSyncState {
  scopeKey: string;
  revision: number;
  exercises: ExerciseDefinitionRow[];
  overrides: ExerciseCoachSyncOverride[];
  favourites: string[];
}

export class ExerciseCoachSyncInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ExerciseCoachSyncInputError';
  }
}

function scopeKey(coachUserId: number): string {
  return `exercise-coach:${coachUserId}`;
}

function cleanSyncId(value: unknown): string {
  if (typeof value !== 'string') throw new ExerciseCoachSyncInputError('INVALID_SYNC_ID', 'Exercise sync id is required');
  const result = value.trim();
  if (!/^[A-Za-z0-9-]{1,80}$/.test(result)) {
    throw new ExerciseCoachSyncInputError('INVALID_SYNC_ID', 'Exercise sync id is invalid');
  }
  return result;
}

function cleanName(value: unknown): string {
  if (typeof value !== 'string') throw new ExerciseCoachSyncInputError('INVALID_NAME', 'Exercise name is required');
  const result = value.trim().slice(0, 120);
  if (!result) throw new ExerciseCoachSyncInputError('INVALID_NAME', 'Exercise name is required');
  return result;
}

function cleanDescription(value: unknown): string | null {
  return typeof value === 'string' ? value.trim().slice(0, 500) || null : null;
}

function cleanTrackingType(value: unknown): TrackingType {
  if (typeof value !== 'string' || !trackingTypes.has(value as TrackingType)) {
    throw new ExerciseCoachSyncInputError('INVALID_TRACKING_TYPE', 'Unsupported exercise tracking type');
  }
  return value as TrackingType;
}

function cleanCategoryCode(value: unknown): ExerciseCategoryCode {
  if (typeof value !== 'string' || !categoryCodes.has(value as ExerciseCategoryCode)) {
    throw new ExerciseCoachSyncInputError('INVALID_CATEGORY', 'Unsupported exercise category');
  }
  return value as ExerciseCategoryCode;
}

function cleanEquipmentCode(value: unknown): ExerciseEquipmentCode {
  if (typeof value !== 'string' || !equipmentCodes.has(value as ExerciseEquipmentCode)) {
    throw new ExerciseCoachSyncInputError('INVALID_EQUIPMENT', 'Unsupported exercise equipment');
  }
  return value as ExerciseEquipmentCode;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseExerciseCoachSyncRequest(value: unknown): ExerciseCoachSyncRequest {
  if (!isRecord(value)) throw new ExerciseCoachSyncInputError('INVALID_SYNC_REQUEST', 'Sync request is invalid');
  const requestId = typeof value.requestId === 'string' ? value.requestId.trim() : '';
  if (!/^[A-Za-z0-9-]{8,100}$/.test(requestId)) {
    throw new ExerciseCoachSyncInputError('INVALID_REQUEST_ID', 'Sync request id is invalid');
  }
  const baseServerRevision = value.baseServerRevision;
  if (!Number.isInteger(baseServerRevision) || (baseServerRevision as number) < 0) {
    throw new ExerciseCoachSyncInputError('INVALID_SERVER_REVISION', 'Server revision is invalid');
  }
  if (!isRecord(value.snapshot)) {
    throw new ExerciseCoachSyncInputError('INVALID_SYNC_SNAPSHOT', 'Sync snapshot is invalid');
  }

  const rawDefinitions = value.snapshot.definitions;
  const rawOverrides = value.snapshot.overrides;
  const rawFavourites = value.snapshot.favourites;
  if (!Array.isArray(rawDefinitions) || rawDefinitions.length > 1000) {
    throw new ExerciseCoachSyncInputError('INVALID_SYNC_SNAPSHOT', 'Exercise definitions are invalid');
  }
  if (!Array.isArray(rawOverrides) || rawOverrides.length > 1000) {
    throw new ExerciseCoachSyncInputError('INVALID_SYNC_SNAPSHOT', 'Exercise overrides are invalid');
  }
  if (!Array.isArray(rawFavourites) || rawFavourites.length > 2000) {
    throw new ExerciseCoachSyncInputError('INVALID_SYNC_SNAPSHOT', 'Exercise favourites are invalid');
  }

  const definitions = rawDefinitions.map((item) => {
    if (!isRecord(item)) throw new ExerciseCoachSyncInputError('INVALID_SYNC_SNAPSHOT', 'Exercise definition is invalid');
    return {
      syncId: cleanSyncId(item.syncId),
      name: cleanName(item.name),
      description: cleanDescription(item.description),
      trackingType: cleanTrackingType(item.trackingType),
      categoryCode: cleanCategoryCode(item.categoryCode),
      equipmentCode: cleanEquipmentCode(item.equipmentCode),
    };
  });
  const definitionIds = new Set<string>();
  const activeNames = new Set<string>();
  for (const definition of definitions) {
    if (definitionIds.has(definition.syncId)) {
      throw new ExerciseCoachSyncInputError('DUPLICATE_SYNC_ID', 'Exercise sync ids must be unique');
    }
    definitionIds.add(definition.syncId);
    const nameKey = definition.name.normalize('NFKC').toLocaleLowerCase('ru-RU');
    if (activeNames.has(nameKey)) {
      throw new ExerciseCoachSyncInputError('EXERCISE_EXISTS', 'Exercise names must be unique');
    }
    activeNames.add(nameKey);
  }

  const overrides = rawOverrides.map((item) => {
    if (!isRecord(item)) throw new ExerciseCoachSyncInputError('INVALID_SYNC_SNAPSHOT', 'Exercise override is invalid');
    return {
      exerciseSyncId: cleanSyncId(item.exerciseSyncId),
      name: cleanName(item.name),
      description: cleanDescription(item.description),
      trackingType: cleanTrackingType(item.trackingType),
      categoryCode: cleanCategoryCode(item.categoryCode),
      equipmentCode: cleanEquipmentCode(item.equipmentCode),
    };
  });
  const overrideIds = new Set<string>();
  for (const override of overrides) {
    if (overrideIds.has(override.exerciseSyncId)) {
      throw new ExerciseCoachSyncInputError('DUPLICATE_OVERRIDE', 'Exercise overrides must be unique');
    }
    overrideIds.add(override.exerciseSyncId);
  }

  const favourites = rawFavourites.map(cleanSyncId);
  if (new Set(favourites).size !== favourites.length) {
    throw new ExerciseCoachSyncInputError('DUPLICATE_FAVOURITE', 'Exercise favourites must be unique');
  }

  return {
    requestId,
    baseServerRevision: baseServerRevision as number,
    snapshot: { definitions, overrides, favourites },
  };
}

async function ensureScopeRevision(db: D1Database, key: string): Promise<number> {
  await db.prepare(
    'INSERT OR IGNORE INTO sync_scope_revision(scope_key, revision) VALUES (?, 0)',
  ).bind(key).run();
  const row = await db.prepare(
    'SELECT revision FROM sync_scope_revision WHERE scope_key = ?',
  ).bind(key).first<{ revision: number }>();
  return row?.revision ?? 0;
}

export async function bumpExerciseCoachRevision(
  db: D1Database,
  coachUserId: number,
): Promise<void> {
  const key = scopeKey(coachUserId);
  await db.prepare(`
    INSERT INTO sync_scope_revision(scope_key, revision, updated_at)
    VALUES (?, 1, CURRENT_TIMESTAMP)
    ON CONFLICT(scope_key) DO UPDATE SET
      revision = sync_scope_revision.revision + 1,
      updated_at = CURRENT_TIMESTAMP
  `).bind(key).run();
}

export async function getExerciseCoachSyncState(
  db: D1Database,
  coachUserId: number,
): Promise<ExerciseCoachSyncState> {
  const key = scopeKey(coachUserId);
  const revision = await ensureScopeRevision(db, key);
  const exercises = await listExercisesForCoach(db, coachUserId, {
    search: '',
    categoryCode: '',
    trackingType: '',
    favouritesOnly: false,
    sort: 'alphabetical',
  });
  const overrides = await db.prepare(`
    SELECT
      e.sync_id AS exercise_sync_id,
      o.name,
      o.description,
      o.tracking_type,
      o.category_code,
      o.equipment_code
    FROM exercise_definition_override o
    JOIN exercise_definition e ON e.id = o.exercise_definition_id
    WHERE o.coach_user_id = ?
      AND e.scope = 'global'
      AND e.is_archived = 0
      AND e.sync_id IS NOT NULL
    ORDER BY e.id
  `).bind(coachUserId).all<{
    exercise_sync_id: string;
    name: string;
    description: string | null;
    tracking_type: TrackingType;
    category_code: ExerciseCategoryCode;
    equipment_code: ExerciseEquipmentCode;
  }>();
  const favourites = await db.prepare(`
    SELECT e.sync_id
    FROM coach_exercise_favourite f
    JOIN exercise_definition e ON e.id = f.exercise_definition_id
    WHERE f.coach_user_id = ?
      AND e.is_archived = 0
      AND e.sync_id IS NOT NULL
      AND (e.scope = 'global' OR (e.scope = 'coach' AND e.owner_coach_user_id = ?))
    ORDER BY e.id
  `).bind(coachUserId, coachUserId).all<{ sync_id: string }>();

  return {
    scopeKey: key,
    revision,
    exercises,
    overrides: overrides.results.map((row) => ({
      exerciseSyncId: row.exercise_sync_id,
      name: row.name,
      description: row.description,
      trackingType: row.tracking_type,
      categoryCode: row.category_code,
      equipmentCode: row.equipment_code,
    })),
    favourites: favourites.results.map((row) => row.sync_id),
  };
}

type VisibleSyncRow = {
  id: number;
  sync_id: string;
  scope: 'global' | 'coach' | 'client';
  owner_coach_user_id: number | null;
  is_archived: number;
  name: string;
};

async function validateSnapshotTargets(
  db: D1Database,
  coachUserId: number,
  snapshot: ExerciseCoachSyncSnapshot,
): Promise<Map<string, VisibleSyncRow>> {
  const rows = await db.prepare(`
    SELECT id, sync_id, scope, owner_coach_user_id, is_archived, name
    FROM exercise_definition
    WHERE sync_id IS NOT NULL
      AND (scope = 'global' OR (scope = 'coach' AND owner_coach_user_id = ?))
  `).bind(coachUserId).all<VisibleSyncRow>();
  const bySyncId = new Map(rows.results.map((row) => [row.sync_id, row]));

  const incomingIds = new Set(snapshot.definitions.map((definition) => definition.syncId));
  const finalNames = new Set<string>();
  for (const row of rows.results) {
    if (
      row.scope === 'coach'
      && row.owner_coach_user_id === coachUserId
      && row.is_archived === 0
      && !incomingIds.has(row.sync_id)
    ) {
      finalNames.add(row.name.normalize('NFKC').toLocaleLowerCase('ru-RU'));
    }
  }
  for (const definition of snapshot.definitions) {
    const existing = bySyncId.get(definition.syncId);
    if (existing && (existing.scope !== 'coach' || existing.owner_coach_user_id !== coachUserId)) {
      throw new ExerciseCoachSyncInputError('SYNC_ID_FORBIDDEN', 'Exercise sync id is not owned by this coach');
    }
    const key = definition.name.normalize('NFKC').toLocaleLowerCase('ru-RU');
    if (finalNames.has(key)) {
      throw new ExerciseCoachSyncInputError('EXERCISE_EXISTS', 'Exercise name already exists');
    }
    finalNames.add(key);
  }
  for (const override of snapshot.overrides) {
    const target = bySyncId.get(override.exerciseSyncId);
    if (!target || target.scope !== 'global' || target.is_archived !== 0) {
      throw new ExerciseCoachSyncInputError('EXERCISE_NOT_FOUND', 'Override target is unavailable');
    }
  }
  const incomingById = new Map(snapshot.definitions.map((definition) => [definition.syncId, definition]));
  for (const favourite of snapshot.favourites) {
    const target = bySyncId.get(favourite);
    const incoming = incomingById.get(favourite);
    const visibleExisting = target
      && target.is_archived === 0
      && (
        target.scope === 'global'
        || (target.scope === 'coach' && target.owner_coach_user_id === coachUserId)
      );
    if (!visibleExisting && !incoming) {
      throw new ExerciseCoachSyncInputError('EXERCISE_NOT_FOUND', 'Favourite target is unavailable');
    }
  }

  return bySyncId;
}

export async function applyExerciseCoachSync(
  db: D1Database,
  coachUserId: number,
  request: ExerciseCoachSyncRequest,
): Promise<{ ok: true; revision: number } | { ok: false; revision: number }> {
  const key = scopeKey(coachUserId);
  const existingRequest = await db.prepare(
    'SELECT response_revision FROM sync_request WHERE request_id = ? AND scope_key = ?',
  ).bind(request.requestId, key).first<{ response_revision: number }>();
  if (existingRequest) return { ok: true, revision: existingRequest.response_revision };

  await ensureScopeRevision(db, key);
  await validateSnapshotTargets(db, coachUserId, request.snapshot);

  const statements: D1PreparedStatement[] = [
    db.prepare(`
      INSERT INTO sync_cas_assert(request_id, ok)
      SELECT ?, CASE WHEN revision = ? THEN 1 ELSE 0 END
      FROM sync_scope_revision
      WHERE scope_key = ?
    `).bind(request.requestId, request.baseServerRevision, key),
  ];

  for (const definition of request.snapshot.definitions) {
    statements.push(
      db.prepare(`
        INSERT INTO exercise_definition (
          sync_id,
          scope,
          owner_coach_user_id,
          name,
          description,
          tracking_type,
          category_code,
          equipment_code,
          is_archived,
          created_by_user_id
        ) VALUES (?, 'coach', ?, ?, ?, ?, ?, ?, 0, ?)
        ON CONFLICT(sync_id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          tracking_type = excluded.tracking_type,
          category_code = excluded.category_code,
          equipment_code = excluded.equipment_code,
          is_archived = 0,
          updated_at = CURRENT_TIMESTAMP
        WHERE exercise_definition.scope = 'coach'
          AND exercise_definition.owner_coach_user_id = excluded.owner_coach_user_id
      `).bind(
        definition.syncId,
        coachUserId,
        definition.name,
        definition.description,
        definition.trackingType,
        definition.categoryCode,
        definition.equipmentCode,
        coachUserId,
      ),
    );
  }

  if (request.snapshot.definitions.length === 0) {
    statements.push(
      db.prepare(`
        UPDATE exercise_definition
        SET is_archived = 1, updated_at = CURRENT_TIMESTAMP
        WHERE scope = 'coach'
          AND owner_coach_user_id = ?
          AND is_archived = 0
      `).bind(coachUserId),
    );
  } else {
    const placeholders = request.snapshot.definitions.map(() => '?').join(',');
    statements.push(
      db.prepare(`
        UPDATE exercise_definition
        SET is_archived = 1, updated_at = CURRENT_TIMESTAMP
        WHERE scope = 'coach'
          AND owner_coach_user_id = ?
          AND is_archived = 0
          AND sync_id NOT IN (${placeholders})
      `).bind(coachUserId, ...request.snapshot.definitions.map((item) => item.syncId)),
    );
  }

  statements.push(
    db.prepare('DELETE FROM exercise_definition_override WHERE coach_user_id = ?').bind(coachUserId),
  );
  for (const override of request.snapshot.overrides) {
    statements.push(
      db.prepare(`
        INSERT INTO exercise_definition_override (
          coach_user_id,
          exercise_definition_id,
          name,
          description,
          tracking_type,
          category_code,
          equipment_code
        )
        SELECT ?, id, ?, ?, ?, ?, ?
        FROM exercise_definition
        WHERE sync_id = ? AND scope = 'global' AND is_archived = 0
      `).bind(
        coachUserId,
        override.name,
        override.description,
        override.trackingType,
        override.categoryCode,
        override.equipmentCode,
        override.exerciseSyncId,
      ),
    );
  }

  statements.push(
    db.prepare('DELETE FROM coach_exercise_favourite WHERE coach_user_id = ?').bind(coachUserId),
  );
  for (const favourite of request.snapshot.favourites) {
    statements.push(
      db.prepare(`
        INSERT INTO coach_exercise_favourite(coach_user_id, exercise_definition_id)
        SELECT ?, id
        FROM exercise_definition
        WHERE sync_id = ?
          AND is_archived = 0
          AND (scope = 'global' OR (scope = 'coach' AND owner_coach_user_id = ?))
      `).bind(coachUserId, favourite, coachUserId),
    );
  }

  const nextRevision = request.baseServerRevision + 1;
  statements.push(
    db.prepare(`
      UPDATE sync_scope_revision
      SET revision = ?, updated_at = CURRENT_TIMESTAMP
      WHERE scope_key = ? AND revision = ?
    `).bind(nextRevision, key, request.baseServerRevision),
    db.prepare(`
      INSERT INTO sync_request(request_id, scope_key, response_revision)
      VALUES (?, ?, ?)
    `).bind(request.requestId, key, nextRevision),
    db.prepare('DELETE FROM sync_cas_assert WHERE request_id = ?').bind(request.requestId),
  );

  try {
    await db.batch(statements);
    return { ok: true, revision: nextRevision };
  } catch (error) {
    const repeated = await db.prepare(
      'SELECT response_revision FROM sync_request WHERE request_id = ? AND scope_key = ?',
    ).bind(request.requestId, key).first<{ response_revision: number }>();
    if (repeated) return { ok: true, revision: repeated.response_revision };

    const current = await ensureScopeRevision(db, key);
    if (current !== request.baseServerRevision) {
      return { ok: false, revision: current };
    }
    throw error;
  }
}
