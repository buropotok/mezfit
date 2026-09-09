export type ExerciseScope = 'global' | 'coach' | 'client';
export type TrackingType = 'weight_reps' | 'time' | 'time_distance' | 'time_reps' | 'time_weight';

export interface ExerciseDefinitionRow {
  id: number;
  scope: ExerciseScope;
  name: string;
  tracking_type: TrackingType;
  primary_muscle: string | null;
  equipment: string | null;
}

export interface CreateExerciseInput {
  scope: 'coach' | 'client';
  name: string;
  trackingType: TrackingType;
  primaryMuscle: string | null;
  equipment: string | null;
}

export async function hasActiveCoachClient(
  db: D1Database,
  coachUserId: number,
  clientUserId: number,
): Promise<boolean> {
  const row = await db
    .prepare(`
      SELECT 1 AS ok
      FROM coach_client
      WHERE coach_user_id = ? AND client_user_id = ? AND status = 'active'
    `)
    .bind(coachUserId, clientUserId)
    .first<{ ok: number }>();
  return row?.ok === 1;
}

export async function listExercisesForClient(
  db: D1Database,
  coachUserId: number,
  clientUserId: number,
  search: string,
): Promise<ExerciseDefinitionRow[]> {
  const pattern = `%${search.toLowerCase()}%`;
  const result = await db
    .prepare(`
      SELECT id, scope, name, tracking_type, primary_muscle, equipment
      FROM exercise_definition
      WHERE is_archived = 0
        AND (
          scope = 'global'
          OR (scope = 'coach' AND owner_coach_user_id = ?)
          OR (scope = 'client' AND owner_coach_user_id = ? AND owner_client_user_id = ?)
        )
        AND (? = '' OR lower(name) LIKE ?)
      ORDER BY
        CASE scope WHEN 'client' THEN 0 WHEN 'coach' THEN 1 ELSE 2 END,
        name COLLATE NOCASE
      LIMIT 200
    `)
    .bind(coachUserId, coachUserId, clientUserId, search, pattern)
    .all<ExerciseDefinitionRow>();
  return result.results;
}

export async function createExerciseForClient(
  db: D1Database,
  coachUserId: number,
  clientUserId: number,
  input: CreateExerciseInput,
): Promise<ExerciseDefinitionRow | null> {
  const ownerClientUserId = input.scope === 'client' ? clientUserId : null;

  const existing = await db
    .prepare(`
      SELECT id
      FROM exercise_definition
      WHERE scope = ?
        AND owner_coach_user_id = ?
        AND ((? IS NULL AND owner_client_user_id IS NULL) OR owner_client_user_id = ?)
        AND lower(name) = lower(?)
      LIMIT 1
    `)
    .bind(input.scope, coachUserId, ownerClientUserId, ownerClientUserId, input.name)
    .first<{ id: number }>();
  if (existing) return null;

  const result = await db
    .prepare(`
      INSERT INTO exercise_definition (
        scope, owner_coach_user_id, owner_client_user_id, name, tracking_type,
        primary_muscle, equipment, created_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id, scope, name, tracking_type, primary_muscle, equipment
    `)
    .bind(
      input.scope,
      coachUserId,
      ownerClientUserId,
      input.name,
      input.trackingType,
      input.primaryMuscle,
      input.equipment,
      coachUserId,
    )
    .first<ExerciseDefinitionRow>();

  return result ?? null;
}
