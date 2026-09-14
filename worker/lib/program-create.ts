import type { ProgramListItem } from './programs';

export async function createProgramForUser(
  db: D1Database,
  userId: number,
  createdByUserId: number,
  name: string,
): Promise<ProgramListItem> {
  const inserted = await db
    .prepare('INSERT INTO training_plan (user_id, name, created_by_user_id) VALUES (?, ?, ?) RETURNING id')
    .bind(userId, name, createdByUserId)
    .first<{ id: number }>();

  if (!inserted) throw new Error('Failed to create training program');

  const positioned = await db
    .prepare(`
      UPDATE training_plan
      SET position = (
        SELECT COALESCE(MAX(position), -1) + 1
        FROM training_plan
        WHERE user_id = ? AND id != ?
      )
      WHERE id = ?
      RETURNING position
    `)
    .bind(userId, inserted.id, inserted.id)
    .first<{ position: number }>();

  if (!positioned) throw new Error('Failed to position training program');

  return {
    id: inserted.id,
    userId,
    name,
    status: 'draft',
    startedAt: null,
    finishedAt: null,
    position: positioned.position,
  };
}
