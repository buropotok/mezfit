export interface ProgramSetInput {
  weightKg: number | null;
  reps: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
}

export interface ProgramSetView extends ProgramSetInput {
  id: number;
  programExerciseId: number;
  position: number;
}

export interface ProgramExerciseOwnerRow {
  program_exercise_id: number;
  training_plan_id: number;
  program_user_id: number;
  coach_user_id: number;
}

interface ProgramSetRow {
  id: number;
  program_exercise_id: number;
  position: number;
  reps: number | null;
  weight: number | null;
  duration_seconds: number | null;
  distance_meters: number | null;
}

export async function getProgramExerciseOwner(
  db: D1Database,
  programExerciseId: number,
): Promise<ProgramExerciseOwnerRow | null> {
  return db.prepare(`
    SELECT
      pe.id AS program_exercise_id,
      p.id AS training_plan_id,
      p.user_id AS program_user_id,
      p.coach_user_id
    FROM program_exercise pe
    JOIN program_day pd ON pd.id = pe.program_day_id
    JOIN program_phase pp ON pp.id = pd.program_phase_id
    JOIN training_plan p ON p.id = pp.training_plan_id
    WHERE pe.id = ? AND pe.status = 'active'
  `).bind(programExerciseId).first<ProgramExerciseOwnerRow>();
}

export async function createProgramSet(
  db: D1Database,
  programExerciseId: number,
  createdByUserId: number,
  input: ProgramSetInput,
): Promise<ProgramSetView> {
  const positionRow = await db.prepare(`
    SELECT COALESCE(MAX(position), -1) + 1 AS position
    FROM program_set
    WHERE program_exercise_id = ? AND status = 'active'
  `).bind(programExerciseId).first<{ position: number }>();
  const position = positionRow?.position ?? 0;

  const result = await db.prepare(`
    INSERT INTO program_set (
      program_exercise_id, position, reps, weight, duration_seconds, distance_meters, created_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING id, program_exercise_id, position, reps, weight, duration_seconds, distance_meters
  `).bind(
    programExerciseId,
    position,
    input.reps,
    input.weightKg,
    input.durationSeconds,
    input.distanceMeters,
    createdByUserId,
  ).first<ProgramSetRow>();

  if (!result) throw new Error('Failed to create program set');
  return {
    id: result.id,
    programExerciseId: result.program_exercise_id,
    position: result.position,
    reps: result.reps,
    weightKg: result.weight,
    durationSeconds: result.duration_seconds,
    distanceMeters: result.distance_meters,
  };
}
