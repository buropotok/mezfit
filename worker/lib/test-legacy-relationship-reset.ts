/**
 * Discard only the legacy D1 program/workout graph belonging to this Coach–Client
 * pair. This is the pre-MVP test reset path, not the production unlink policy.
 * D1.batch executes these statements in a transaction. Never erase accounts,
 * reusable invitations, private plans or another coach's records.
 */
export async function resetLegacyTestRelationship(
  db: D1Database, coachUserId: number, clientUserId: number,
): Promise<void> {
  // The pair is bound as values in every statement. All descendants are
  // resolved from the immutable plan owner and occurrence participants.
  const scope = `
    WITH pair(coach, client) AS (VALUES (?, ?)),
      plans AS (
        SELECT id FROM training_plan
        WHERE owner_coach_user_id = (SELECT coach FROM pair)
          AND user_id = (SELECT client FROM pair)
      ),
      phases AS (SELECT id FROM program_phase WHERE training_plan_id IN (SELECT id FROM plans)),
      days AS (SELECT id FROM program_day WHERE program_phase_id IN (SELECT id FROM phases)),
      exercises AS (SELECT id FROM program_exercise WHERE program_day_id IN (SELECT id FROM days)),
      occurrences AS (
        SELECT id FROM workout_occurrence WHERE coach_user_id = (SELECT coach FROM pair)
          AND client_user_id = (SELECT client FROM pair)
      ),
      sessions AS (
        SELECT id FROM workout_session
        WHERE occurrence_id IN (SELECT id FROM occurrences)
          OR (user_id = (SELECT client FROM pair)
            AND (started_by_user_id = (SELECT coach FROM pair)
              OR source_program_phase_id IN (SELECT id FROM phases)
              OR source_program_day_id IN (SELECT id FROM days)))
      )
  `;
  const deletes = [
    `DELETE FROM session_set WHERE session_exercise_id IN (
      SELECT id FROM session_exercise WHERE workout_session_id IN (SELECT id FROM sessions))`,
    `DELETE FROM session_exercise WHERE workout_session_id IN (SELECT id FROM sessions)`,
    `DELETE FROM workout_session WHERE id IN (SELECT id FROM sessions)`,
    `DELETE FROM workout_occurrence WHERE id IN (SELECT id FROM occurrences)`,
    `DELETE FROM program_set WHERE program_exercise_id IN (SELECT id FROM exercises)`,
    `DELETE FROM program_exercise WHERE id IN (SELECT id FROM exercises)`,
    `DELETE FROM program_day WHERE id IN (SELECT id FROM days)`,
    `DELETE FROM program_phase WHERE id IN (SELECT id FROM phases)`,
    `DELETE FROM training_plan WHERE id IN (SELECT id FROM plans)`,
  ];
  const statements = deletes.map(sql => db.prepare(scope + sql).bind(coachUserId, clientUserId));
  statements.push(db.prepare(`
    UPDATE coach_client SET status = 'inactive', updated_at = CURRENT_TIMESTAMP
    WHERE coach_user_id = ? AND client_user_id = ? AND status = 'active'
  `).bind(coachUserId, clientUserId));
  await db.batch(statements);
}
