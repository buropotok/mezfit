export interface ProgramSetInput {
  setNumber: number;
  weightKg: number | null;
  reps: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
}

export interface ProgramSetView extends ProgramSetInput {
  id: number;
  programExerciseId: number;
}

interface ProgramExerciseOwnerRow {
  program_id: number;
  coach_user_id: number;
  user_id: number;
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
    SELECT tp.id AS program_id, COALESCE(tp.owner_coach_user_id, tp.created_by_user_id) AS coach_user_id, tp.user_id
    FROM program_exercise pe
    JOIN program_day pd ON pd.id = pe.program_day_id
    JOIN program_phase pp ON pp.id = pd.program_phase_id
    JOIN training_plan tp ON tp.id = pp.training_plan_id
    WHERE pe.id = ?
      AND pe.status = 'active'
      AND pd.status = 'active'
      AND pp.status IN ('pending', 'active')
  `).bind(programExerciseId).first<ProgramExerciseOwnerRow>();
}

export async function createProgramSet(
  db: D1Database,
  programExerciseId: number,
  createdByUserId: number,
  input: ProgramSetInput,
): Promise<ProgramSetView | null> {
  const position = input.setNumber - 1;
  const result = await db.prepare(`
    INSERT OR IGNORE INTO program_set (
      program_exercise_id,
      position,
      reps,
      weight,
      duration_seconds,
      distance_meters,
      created_by_user_id
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

  if (!result) return null;
  return {
    id: result.id,
    programExerciseId: result.program_exercise_id,
    setNumber: result.position + 1,
    reps: result.reps,
    weightKg: result.weight,
    durationSeconds: result.duration_seconds,
    distanceMeters: result.distance_meters,
  };
}
