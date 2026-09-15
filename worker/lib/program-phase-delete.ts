export type DeleteProgramPhaseResult = 'deleted' | 'not_found' | 'in_use';

interface ProgramPhaseUsageRow {
  in_use: number;
}

const COMPACTION_OFFSET = 1_000_000_000;
const TARGET_OFFSET = COMPACTION_OFFSET * 2;

export async function deleteProgramPhase(
  db: D1Database,
  programId: number,
  phaseId: number,
): Promise<DeleteProgramPhaseResult> {
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

  const results = await db.batch([
    // Move the target out of the normal position range first. Later statements
    // derive its current position from this row inside the same atomic batch,
    // so concurrent deletes cannot compact using a stale pre-batch position.
    db.prepare(`
      UPDATE program_phase
      SET position = position + ?
      WHERE id = ? AND training_plan_id = ?
    `).bind(TARGET_OFFSET, phaseId, programId),
    db.prepare(`
      UPDATE program_phase
      SET position = position + ?
      WHERE training_plan_id = ?
        AND id != ?
        AND position < ?
        AND position > (
          SELECT position - ?
          FROM program_phase
          WHERE id = ? AND training_plan_id = ? AND position >= ?
        )
    `).bind(
      COMPACTION_OFFSET,
      programId,
      phaseId,
      COMPACTION_OFFSET,
      TARGET_OFFSET,
      phaseId,
      programId,
      TARGET_OFFSET,
    ),
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
      SET position = position - ?, updated_at = CURRENT_TIMESTAMP
      WHERE training_plan_id = ?
        AND position >= ?
        AND position < ?
    `).bind(COMPACTION_OFFSET + 1, programId, COMPACTION_OFFSET, TARGET_OFFSET),
    db.prepare('UPDATE training_plan SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(programId),
  ]);

  const targetWasMarked = (results[0]?.meta?.changes ?? 0) > 0;
  return targetWasMarked ? 'deleted' : 'not_found';
}
