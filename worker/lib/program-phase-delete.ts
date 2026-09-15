export type DeleteProgramPhaseResult = 'deleted' | 'not_found' | 'in_use';

interface ProgramPhaseDeleteRow {
  position: number;
}

interface ProgramPhaseUsageRow {
  in_use: number;
}

export async function deleteProgramPhase(
  db: D1Database,
  programId: number,
  phaseId: number,
): Promise<DeleteProgramPhaseResult> {
  const phase = await db.prepare(`
    SELECT position
    FROM program_phase
    WHERE id = ? AND training_plan_id = ?
  `).bind(phaseId, programId).first<ProgramPhaseDeleteRow>();
  if (!phase) return 'not_found';

  const usage = await db.prepare(`
    SELECT CASE WHEN
      EXISTS (
        SELECT 1
        FROM workout_session
        WHERE source_program_phase_id = ?
      )
      OR EXISTS (
        SELECT 1
        FROM workout_session session
        JOIN program_day day ON day.id = session.source_program_day_id
        WHERE day.program_phase_id = ?
      )
      OR EXISTS (
        SELECT 1
        FROM session_exercise session_exercise
        JOIN program_exercise program_exercise
          ON program_exercise.id = session_exercise.source_program_exercise_id
        JOIN program_day day ON day.id = program_exercise.program_day_id
        WHERE day.program_phase_id = ?
      )
      OR EXISTS (
        SELECT 1
        FROM session_set session_set
        JOIN program_set program_set ON program_set.id = session_set.source_program_set_id
        JOIN program_exercise program_exercise ON program_exercise.id = program_set.program_exercise_id
        JOIN program_day day ON day.id = program_exercise.program_day_id
        WHERE day.program_phase_id = ?
      )
    THEN 1 ELSE 0 END AS in_use
  `).bind(phaseId, phaseId, phaseId, phaseId).first<ProgramPhaseUsageRow>();
  if (usage?.in_use === 1) return 'in_use';

  const shiftedPositionFloor = phase.position + 1 + 1_000_000;
  await db.batch([
    db.prepare(`
      DELETE FROM program_set
      WHERE program_exercise_id IN (
        SELECT program_exercise.id
        FROM program_exercise
        JOIN program_day ON program_day.id = program_exercise.program_day_id
        WHERE program_day.program_phase_id = ?
      )
    `).bind(phaseId),
    db.prepare(`
      DELETE FROM program_exercise
      WHERE program_day_id IN (
        SELECT id FROM program_day WHERE program_phase_id = ?
      )
    `).bind(phaseId),
    db.prepare('DELETE FROM program_day WHERE program_phase_id = ?').bind(phaseId),
    db.prepare('DELETE FROM program_phase WHERE id = ? AND training_plan_id = ?').bind(phaseId, programId),
    db.prepare(`
      UPDATE program_phase
      SET position = position + 1000000
      WHERE training_plan_id = ? AND position > ?
    `).bind(programId, phase.position),
    db.prepare(`
      UPDATE program_phase
      SET position = position - 1000001, updated_at = CURRENT_TIMESTAMP
      WHERE training_plan_id = ? AND position >= ?
    `).bind(programId, shiftedPositionFloor),
    db.prepare('UPDATE training_plan SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(programId),
  ]);

  return 'deleted';
}
