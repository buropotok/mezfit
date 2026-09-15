import type { ProgramListItem } from './programs';

export async function createProgramForUser(
  db: D1Database,
  userId: number,
  createdByUserId: number,
  name: string,
): Promise<ProgramListItem> {
  const row = await db
    .prepare(`
      INSERT INTO training_plan (user_id, owner_coach_user_id, name, created_by_user_id, position)
      SELECT ?, ?, ?, ?, COALESCE(MAX(position), -1) + 1
      FROM training_plan
      WHERE user_id = ? AND owner_coach_user_id = ?
      RETURNING id, position
    `)
    .bind(userId, createdByUserId, name, createdByUserId, userId, createdByUserId)
    .first<{ id: number; position: number }>();

  if (!row) throw new Error('Failed to create training program');

  return {
    id: row.id,
    userId,
    name,
    status: 'draft',
    startedAt: null,
    finishedAt: null,
    position: row.position,
  };
}
