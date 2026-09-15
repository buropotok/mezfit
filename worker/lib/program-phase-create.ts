import type { ProgramPhaseDetails } from './program-details';

interface ProgramPhaseInsertRow {
  id: number;
  name: string;
  position: number;
  status: ProgramPhaseDetails['status'];
  planned_start_date: string | null;
  planned_end_date: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export async function createProgramPhase(
  db: D1Database,
  programId: number,
  coachUserId: number,
  name: string,
): Promise<ProgramPhaseDetails | null> {
  const row = await db.prepare(`
    INSERT INTO program_phase (
      training_plan_id,
      name,
      position,
      status,
      created_by_user_id
    )
    SELECT
      plan.id,
      ?,
      COALESCE((
        SELECT MAX(existing.position) + 1
        FROM program_phase existing
        WHERE existing.training_plan_id = plan.id
      ), 0),
      'pending',
      ?
    FROM training_plan plan
    WHERE plan.id = ?
      AND (plan.user_id = ? OR plan.owner_coach_user_id = ?)
    RETURNING id, name, position, status, planned_start_date, planned_end_date, started_at, finished_at
  `).bind(name, coachUserId, programId, coachUserId, coachUserId).first<ProgramPhaseInsertRow>();

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    position: row.position,
    status: row.status,
    plannedStartDate: row.planned_start_date,
    plannedEndDate: row.planned_end_date,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    completedExerciseCount: 0,
    exerciseCount: 0,
    progressPercent: 0,
    exercises: [],
  };
}
