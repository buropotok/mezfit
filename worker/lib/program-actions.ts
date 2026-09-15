import type { ProgramListItem } from './programs';

export interface ProgramOwnerIds {
  userId: number;
  coachUserId: number | null;
}

export async function getProgramOwnerIds(db: D1Database, programId: number): Promise<ProgramOwnerIds | null> {
  const row = await db
    .prepare('SELECT user_id, owner_coach_user_id, created_by_user_id FROM training_plan WHERE id = ?')
    .bind(programId)
    .first<{ user_id: number; owner_coach_user_id: number | null; created_by_user_id: number }>();
  return row ? { userId: row.user_id, coachUserId: row.owner_coach_user_id ?? row.created_by_user_id } : null;
}

export async function duplicateProgram(
  db: D1Database,
  programId: number,
  actorUserId: number,
): Promise<ProgramListItem> {
  const source = await db
    .prepare(`
      SELECT id, user_id, name
      FROM training_plan
      WHERE id = ? AND COALESCE(owner_coach_user_id, created_by_user_id) = ?
    `)
    .bind(programId, actorUserId)
    .first<{ id: number; user_id: number; name: string }>();
  if (!source) throw new Error('PROGRAM_NOT_FOUND');

  const copyName = `${source.name.slice(0, 112)} (копия)`;
  const targetPlanIdSql = '(SELECT id FROM training_plan WHERE user_id = ? AND owner_coach_user_id = ? ORDER BY id DESC LIMIT 1)';
  const results = await db.batch([
    db.prepare(`
      INSERT INTO training_plan (user_id, owner_coach_user_id, name, created_by_user_id, position)
      VALUES (?, ?, ?, ?, (
        SELECT COALESCE(MAX(position), -1) + 1
        FROM training_plan
        WHERE user_id = ? AND COALESCE(owner_coach_user_id, created_by_user_id) = ?
      ))
      RETURNING id, position
    `).bind(source.user_id, actorUserId, copyName, actorUserId, source.user_id, actorUserId),
    db.prepare(`
      INSERT INTO program_phase (
        training_plan_id, name, position, status, planned_start_date, planned_end_date,
        started_at, finished_at, created_by_user_id
      )
      SELECT ${targetPlanIdSql}, name, position, 'pending', planned_start_date, planned_end_date, NULL, NULL, ?
      FROM program_phase
      WHERE training_plan_id = ?
      ORDER BY position
    `).bind(source.user_id, actorUserId, actorUserId, source.id),
    db.prepare(`
      INSERT INTO program_day (program_phase_id, name, position, created_by_user_id, status)
      SELECT target_phase.id, source_day.name, source_day.position, ?, 'active'
      FROM program_day source_day
      JOIN program_phase source_phase ON source_phase.id = source_day.program_phase_id
      JOIN program_phase target_phase
        ON target_phase.training_plan_id = ${targetPlanIdSql} AND target_phase.position = source_phase.position
      WHERE source_phase.training_plan_id = ? AND source_day.status = 'active'
      ORDER BY source_phase.position, source_day.position
    `).bind(actorUserId, source.user_id, actorUserId, source.id),
    db.prepare(`
      INSERT INTO program_exercise (
        program_day_id, exercise_definition_id, position, created_by_user_id, status, notes
      )
      SELECT target_day.id, source_exercise.exercise_definition_id, source_exercise.position, ?, 'active', source_exercise.notes
      FROM program_exercise source_exercise
      JOIN program_day source_day ON source_day.id = source_exercise.program_day_id
      JOIN program_phase source_phase ON source_phase.id = source_day.program_phase_id
      JOIN program_phase target_phase
        ON target_phase.training_plan_id = ${targetPlanIdSql} AND target_phase.position = source_phase.position
      JOIN program_day target_day
        ON target_day.program_phase_id = target_phase.id AND target_day.position = source_day.position AND target_day.status = 'active'
      WHERE source_phase.training_plan_id = ?
        AND source_day.status = 'active'
        AND source_exercise.status = 'active'
      ORDER BY source_phase.position, source_day.position, source_exercise.position
    `).bind(actorUserId, source.user_id, actorUserId, source.id),
    db.prepare(`
      INSERT INTO program_set (
        program_exercise_id, position, reps, weight, duration_seconds, distance_meters,
        created_by_user_id, status
      )
      SELECT target_exercise.id, source_set.position, source_set.reps, source_set.weight,
        source_set.duration_seconds, source_set.distance_meters, ?, 'active'
      FROM program_set source_set
      JOIN program_exercise source_exercise ON source_exercise.id = source_set.program_exercise_id
      JOIN program_day source_day ON source_day.id = source_exercise.program_day_id
      JOIN program_phase source_phase ON source_phase.id = source_day.program_phase_id
      JOIN program_phase target_phase
        ON target_phase.training_plan_id = ${targetPlanIdSql} AND target_phase.position = source_phase.position
      JOIN program_day target_day
        ON target_day.program_phase_id = target_phase.id AND target_day.position = source_day.position AND target_day.status = 'active'
      JOIN program_exercise target_exercise
        ON target_exercise.program_day_id = target_day.id
       AND target_exercise.position = source_exercise.position
       AND target_exercise.status = 'active'
      WHERE source_phase.training_plan_id = ?
        AND source_day.status = 'active'
        AND source_exercise.status = 'active'
        AND source_set.status = 'active'
      ORDER BY source_phase.position, source_day.position, source_exercise.position, source_set.position
    `).bind(actorUserId, source.user_id, actorUserId, source.id),
  ]);

  const created = results[0]?.results[0] as { id?: unknown; position?: unknown } | undefined;
  if (!created || typeof created.id !== 'number' || typeof created.position !== 'number') {
    throw new Error('Failed to duplicate training program');
  }

  return {
    id: created.id,
    userId: source.user_id,
    name: copyName,
    status: 'draft',
    startedAt: null,
    finishedAt: null,
    position: created.position,
  };
}

export async function reorderPrograms(
  db: D1Database,
  ownerUserId: number,
  coachUserId: number,
  programIds: number[],
): Promise<void> {
  if (programIds.length === 0 || new Set(programIds).size !== programIds.length) {
    throw new Error('INVALID_PROGRAM_ORDER');
  }

  const placeholders = programIds.map(() => '?').join(', ');
  const [selected, total] = await Promise.all([
    db.prepare(`
      SELECT id
      FROM training_plan
      WHERE user_id = ?
        AND COALESCE(owner_coach_user_id, created_by_user_id) = ?
        AND id IN (${placeholders})
    `)
      .bind(ownerUserId, coachUserId, ...programIds)
      .all<{ id: number }>(),
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM training_plan
      WHERE user_id = ? AND COALESCE(owner_coach_user_id, created_by_user_id) = ?
    `)
      .bind(ownerUserId, coachUserId)
      .first<{ count: number }>(),
  ]);
  if (selected.results.length !== programIds.length || total?.count !== programIds.length) {
    throw new Error('INVALID_PROGRAM_ORDER');
  }

  await db.batch([
    db.prepare(`
      UPDATE training_plan
      SET position = position + 1000000
      WHERE user_id = ? AND COALESCE(owner_coach_user_id, created_by_user_id) = ?
    `).bind(ownerUserId, coachUserId),
    ...programIds.map((id, position) => (
      db.prepare(`
        UPDATE training_plan
        SET position = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND user_id = ?
          AND COALESCE(owner_coach_user_id, created_by_user_id) = ?
      `).bind(position, id, ownerUserId, coachUserId)
    )),
  ]);
}
