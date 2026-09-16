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
      AND (? = '%%' OR e.name LIKE ? COLLATE NOCASE OR COALESCE(e.name_en, '') LIKE ? COLLATE NOCASE)
    ORDER BY e.name COLLATE NOCASE, e.id
    LIMIT 250
  `).bind(userId, userId, userId, needle, needle, needle).all<ExerciseOptionRow>();

  return result.results.map((row) => ({
    ...row,
    is_favourite: false,
    can_edit: false,
  }));
}

async function exerciseIsAvailable(db: D1Database, userId: number, exerciseDefinitionId: number): Promise<boolean> {
  const row = await db.prepare(`
    SELECT e.id
    FROM exercise_definition e
    WHERE e.id = ?
      AND e.is_archived = 0
      AND ${exerciseVisibilitySql()}
    LIMIT 1
  `).bind(exerciseDefinitionId, userId, userId, userId).first<{ id: number }>();
  return Boolean(row);
}

export type AddWorkoutExerciseResult =
  | { kind: 'ok'; session: ActiveWorkoutSession }
  | { kind: 'not_found' }
  | { kind: 'invalid_state' }
  | { kind: 'exercise_not_found' };

export async function addWorkoutExercise(
  db: D1Database,
  userId: number,
  workoutSessionId: number,
  exerciseDefinitionId: number,
): Promise<AddWorkoutExerciseResult> {
  const workout = await db.prepare(`
    SELECT id, status
    FROM workout_session
    WHERE id = ? AND user_id = ?
    LIMIT 1
  `).bind(workoutSessionId, userId).first<{ id: number; status: string }>();
  if (!workout) return { kind: 'not_found' };
  if (workout.status !== 'active') return { kind: 'invalid_state' };
  if (!(await exerciseIsAvailable(db, userId, exerciseDefinitionId))) return { kind: 'exercise_not_found' };

  await db.batch([
    db.prepare(`
      INSERT INTO session_exercise (
        workout_session_id,
        exercise_definition_id,
        source_program_exercise_id,
        position,
        status,
        added_by_user_id,
        notes
      )
      SELECT ?, ?, NULL, COALESCE(MAX(position), -1) + 1, 'active', ?, NULL
      FROM session_exercise
      WHERE workout_session_id = ?
    `).bind(workoutSessionId, exerciseDefinitionId, userId, workoutSessionId),
    db.prepare(`
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
      SELECT se.id, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'pending', ?, ?
      FROM session_exercise se
      WHERE se.workout_session_id = ?
      ORDER BY se.position DESC, se.id DESC
      LIMIT 1
    `).bind(userId, userId, workoutSessionId),
  ]);

  const session = await getWorkoutSessionProjection(db, userId, workoutSessionId);
  if (!session) throw new Error('WORKOUT_PROJECTION_MISSING_AFTER_EXERCISE_ADD');
  return { kind: 'ok', session };
}
