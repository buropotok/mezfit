import type { ExerciseCategoryCode, ExerciseEquipmentCode, ExerciseScope, TrackingType } from './exercises';
import { getWorkoutSessionProjection, type ActiveWorkoutSession } from './workout-sessions';

export interface WorkoutExerciseOption {
  id: number;
  scope: ExerciseScope;
  name: string;
  description: string | null;
  tracking_type: TrackingType;
  category_code: ExerciseCategoryCode | null;
  equipment_code: ExerciseEquipmentCode | null;
  reference_source: string | null;
  reference_key: string | null;
  reference_media_url: string | null;
  is_favourite: boolean;
  can_edit: boolean;
}

type ExerciseOptionRow = Omit<WorkoutExerciseOption, 'is_favourite' | 'can_edit'>;

function exerciseVisibilitySql(): string {
  return `(
    e.scope = 'global'
    OR (e.scope = 'client' AND e.owner_client_user_id = ?)
    OR (
      e.scope = 'coach'
      AND (
        e.owner_coach_user_id = ?
        OR EXISTS (
          SELECT 1
          FROM coach_client cc
          WHERE cc.coach_user_id = e.owner_coach_user_id
            AND cc.client_user_id = ?
            AND cc.status = 'active'
        )
      )
    )
  )`;
}

export async function listWorkoutExerciseOptions(
  db: D1Database,
  userId: number,
  categoryCode: ExerciseCategoryCode,
  search: string,
): Promise<WorkoutExerciseOption[]> {
  const needle = `%${search.trim().slice(0, 100)}%`;
  const result = await db.prepare(`
    SELECT
      e.id,
      e.scope,
      e.name,
      e.description,
      e.tracking_type,
      e.category_code,
      e.equipment_code,
      e.reference_source,
      e.reference_key,
      e.reference_media_url
    FROM exercise_definition e
    WHERE e.is_archived = 0
      AND ${exerciseVisibilitySql()}
      AND COALESCE(e.category_code, 'other') = ?
      AND (? = '%%' OR e.name LIKE ? COLLATE NOCASE OR COALESCE(e.name_en, '') LIKE ? COLLATE NOCASE)
    ORDER BY e.name COLLATE NOCASE, e.id
    LIMIT 250
  `).bind(userId, userId, userId, categoryCode, needle, needle, needle).all<ExerciseOptionRow>();

  return result.results.map((row) => ({
    ...row,
    is_favourite: false,
    can_edit: false,
  }));
}

function selectedValuesSql(count: number): string {
  return Array.from({ length: count }, (_, index) => `(?, ${index})`).join(', ');
}

async function countAvailableExercises(db: D1Database, userId: number, exerciseDefinitionIds: number[]): Promise<number> {
  const placeholders = exerciseDefinitionIds.map(() => '?').join(', ');
  const row = await db.prepare(`
    SELECT COUNT(DISTINCT e.id) AS count
    FROM exercise_definition e
    WHERE e.id IN (${placeholders})
      AND e.is_archived = 0
      AND ${exerciseVisibilitySql()}
  `).bind(...exerciseDefinitionIds, userId, userId, userId).first<{ count: number }>();
  return row?.count ?? 0;
}

export type AddWorkoutExercisesResult =
  | { kind: 'ok'; session: ActiveWorkoutSession }
  | { kind: 'not_found' }
  | { kind: 'invalid_state' }
  | { kind: 'exercise_not_found' };

export async function addWorkoutExercises(
  db: D1Database,
  userId: number,
  workoutSessionId: number,
  exerciseDefinitionIds: number[],
): Promise<AddWorkoutExercisesResult> {
  const expectedCount = exerciseDefinitionIds.length;
  const selectedValues = selectedValuesSql(expectedCount);
  const batchResults = await db.batch([
    db.prepare(`
      WITH selected(exercise_definition_id, ordinal) AS (
        VALUES ${selectedValues}
      ),
      eligible AS (
        SELECT selected.exercise_definition_id, selected.ordinal
        FROM selected
        JOIN exercise_definition e ON e.id = selected.exercise_definition_id
        WHERE e.is_archived = 0
          AND ${exerciseVisibilitySql()}
      ),
      active_workout AS (
        SELECT id
        FROM workout_session
        WHERE id = ? AND user_id = ? AND status = 'active'
      ),
      base_position AS (
        SELECT COALESCE(MAX(position), -1) + 1 AS value
        FROM session_exercise
        WHERE workout_session_id = ?
      )
      INSERT INTO session_exercise (
        workout_session_id,
        exercise_definition_id,
        source_program_exercise_id,
        position,
        status,
        added_by_user_id,
        notes
      )
      SELECT
        active_workout.id,
        eligible.exercise_definition_id,
        NULL,
        base_position.value + eligible.ordinal,
        'active',
        ?,
        NULL
      FROM active_workout
      CROSS JOIN base_position
      CROSS JOIN eligible
      WHERE (SELECT COUNT(*) FROM eligible) = ?
      ORDER BY eligible.ordinal
    `).bind(
      ...exerciseDefinitionIds,
      userId,
      userId,
      userId,
      workoutSessionId,
      userId,
      workoutSessionId,
      userId,
      expectedCount,
    ),
    db.prepare(`
      WITH selected(exercise_definition_id, ordinal) AS (
        VALUES ${selectedValues}
      ),
      last_position AS (
        SELECT MAX(position) AS value
        FROM session_exercise
        WHERE workout_session_id = ?
      ),
      created AS (
        SELECT se.id
        FROM selected
        CROSS JOIN last_position
        JOIN session_exercise se
          ON se.workout_session_id = ?
          AND se.exercise_definition_id = selected.exercise_definition_id
          AND se.position = last_position.value - (? - 1) + selected.ordinal
      )
      INSERT INTO session_set (
        session_exercise_id,
        source_program_set_id,
        position,
        planned_reps,
        planned_weight,
        planned_duration_seconds,
        planned_distance_meters,
        actual_reps,
        actual_weight,
        actual_duration_seconds,
        actual_distance_meters,
        set_label,
        rpe,
        comment,
        bands_json,
        status,
        created_by_user_id,
        updated_by_user_id
      )
      SELECT
        created.id,
        NULL,
        0,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        'pending',
        ?,
        ?
      FROM created
      WHERE changes() = ?
        AND (SELECT COUNT(*) FROM created) = ?
    `).bind(
      ...exerciseDefinitionIds,
      workoutSessionId,
      workoutSessionId,
      expectedCount,
      userId,
      userId,
      expectedCount,
      expectedCount,
    ),
  ]);

  const insertedCount = Number(batchResults[0]?.meta?.changes ?? 0);
  const setCount = Number(batchResults[1]?.meta?.changes ?? 0);
  if (insertedCount === expectedCount && setCount === expectedCount) {
    const session = await getWorkoutSessionProjection(db, userId, workoutSessionId);
    if (!session) throw new Error('WORKOUT_PROJECTION_MISSING_AFTER_EXERCISE_ADD');
    return { kind: 'ok', session };
  }
  if (insertedCount !== 0 || setCount !== 0) {
    throw new Error('WORKOUT_EXERCISE_BATCH_PARTIAL_INSERT');
  }

  const workout = await db.prepare(`
    SELECT status
    FROM workout_session
    WHERE id = ? AND user_id = ?
    LIMIT 1
  `).bind(workoutSessionId, userId).first<{ status: string }>();
  if (!workout) return { kind: 'not_found' };
  if (workout.status !== 'active') return { kind: 'invalid_state' };
  if (await countAvailableExercises(db, userId, exerciseDefinitionIds) !== expectedCount) {
    return { kind: 'exercise_not_found' };
  }

  throw new Error('WORKOUT_EXERCISE_GUARDED_INSERT_REJECTED');
}
