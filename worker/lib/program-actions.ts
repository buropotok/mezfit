import type { ProgramListItem } from './programs';

export async function getProgramOwnerUserId(db: D1Database, programId: number): Promise<number | null> {
  const row = await db
    .prepare('SELECT user_id FROM training_plan WHERE id = ?')
    .bind(programId)
    .first<{ user_id: number }>();
  return row?.user_id ?? null;
}

export async function duplicateProgram(
  db: D1Database,
  programId: number,
  actorUserId: number,
): Promise<ProgramListItem> {
  const source = await db
    .prepare('SELECT id, user_id, name FROM training_plan WHERE id = ?')
    .bind(programId)
    .first<{ id: number; user_id: number; name: string }>();
  if (!source) throw new Error('PROGRAM_NOT_FOUND');

  const copyName = `${source.name} (копия)`.slice(0, 120);
  const created = await db
    .prepare(`
      INSERT INTO training_plan (user_id, name, created_by_user_id, position)
      VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM training_plan WHERE user_id = ?))
      RETURNING id, position
    `)
    .bind(source.user_id, copyName, actorUserId, source.user_id)
    .first<{ id: number; position: number }>();
  if (!created) throw new Error('Failed to duplicate training program');

  try {
    await db.batch([
      db.prepare(`
        INSERT INTO program_phase (
          training_plan_id, name, position, status, planned_start_date, planned_end_date,
          started_at, finished_at, created_by_user_id
        )
        SELECT ?, name, position, 'pending', planned_start_date, planned_end_date, NULL, NULL, ?
        FROM program_phase
        WHERE training_plan_id = ?
        ORDER BY position
      `).bind(created.id, actorUserId, source.id),
      db.prepare(`
        INSERT INTO program_day (program_phase_id, name, position, created_by_user_id, status)
        SELECT target_phase.id, source_day.name, source_day.position, ?, 'active'
        FROM program_day source_day
        JOIN program_phase source_phase ON source_phase.id = source_day.program_phase_id
        JOIN program_phase target_phase
          ON target_phase.training_plan_id = ? AND target_phase.position = source_phase.position
        WHERE source_phase.training_plan_id = ? AND source_day.status = 'active'
        ORDER BY source_phase.position, source_day.position
      `).bind(actorUserId, created.id, source.id),
      db.prepare(`
        INSERT INTO program_exercise (
          program_day_id, exercise_definition_id, position, created_by_user_id, status, notes
        )
        SELECT target_day.id, source_exercise.exercise_definition_id, source_exercise.position, ?, 'active', source_exercise.notes
        FROM program_exercise source_exercise
        JOIN program_day source_day ON source_day.id = source_exercise.program_day_id
        JOIN program_phase source_phase ON source_phase.id = source_day.program_phase_id
        JOIN program_phase target_phase
          ON target_phase.training_plan_id = ? AND target_phase.position = source_phase.position
        JOIN program_day target_day
          ON target_day.program_phase_id = target_phase.id AND target_day.position = source_day.position AND target_day.status = 'active'
        WHERE source_phase.training_plan_id = ?
          AND source_day.status = 'active'
          AND source_exercise.status = 'active'
        ORDER BY source_phase.position, source_day.position, source_exercise.position
      `).bind(actorUserId, created.id, source.id),
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
          ON target_phase.training_plan_id = ? AND target_phase.position = source_phase.position
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
      `).bind(actorUserId, created.id, source.id),
    ]);
  } catch (error) {
    await db.prepare('DELETE FROM training_plan WHERE id = ?').bind(created.id).run();
    throw error;
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
  programIds: number[],
): Promise<void> {
  if (programIds.length === 0 || new Set(programIds).size !== programIds.length) {
    throw new Error('INVALID_PROGRAM_ORDER');
  }

  const placeholders = programIds.map(() => '?').join(', ');
  const [selected, total] = await Promise.all([
    db.prepare(`SELECT id FROM training_plan WHERE user_id = ? AND id IN (${placeholders})`)
      .bind(ownerUserId, ...programIds)
      .all<{ id: number }>(),
    db.prepare('SELECT COUNT(*) AS count FROM training_plan WHERE user_id = ?')
      .bind(ownerUserId)
      .first<{ count: number }>(),
  ]);
  if (selected.results.length !== programIds.length || total?.count !== programIds.length) {
    throw new Error('INVALID_PROGRAM_ORDER');
  }

  await db.batch([
    db.prepare('UPDATE training_plan SET position = position + 1000000 WHERE user_id = ?').bind(ownerUserId),
    ...programIds.map((id, position) => (
      db.prepare('UPDATE training_plan SET position = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
        .bind(position, id, ownerUserId)
    )),
  ]);
}
