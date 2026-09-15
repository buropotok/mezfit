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
  set_number: number;
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
    SELECT p.id AS program_id, p.coach_user_id, p.user_id
    FROM program_exercise pe
    JOIN program_day pd ON pd.id = pe.program_day_id
    JOIN program_phase pp ON pp.id = pd.program_phase_id
    JOIN program p ON p.id = pp.program_id
    WHERE pe.id = ?
  `).bind(programExerciseId).first<ProgramExerciseOwnerRow>();
}

export async function createProgramSet(
  db: D1Database,
  programExerciseId: number,
  input: ProgramSetInput,
): Promise<ProgramSetView> {
  const result = await db.prepare(`
    INSERT INTO program_set (
      program_exercise_id,
      set_number,
      reps,
      weight,
      duration_seconds,
      distance_meters
    ) VALUES (?, ?, ?, ?, ?, ?)
    RETURNING id, program_exercise_id, set_number, reps, weight, duration_seconds, distance_meters
  `).bind(
    programExerciseId,
    input.setNumber,
    input.reps,
    input.weightKg,
    input.durationSeconds,
    input.distanceMeters,
  ).first<ProgramSetRow>();

  if (!result) throw new Error('Failed to create program set');
  return {
    id: result.id,
    programExerciseId: result.program_exercise_id,
    setNumber: result.set_number,
    reps: result.reps,
    weightKg: result.weight,
    durationSeconds: result.duration_seconds,
    distanceMeters: result.distance_meters,
  };
}
