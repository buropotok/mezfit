import type { ProgramListItem } from './programs';

export async function createProgramForUser(
  db: D1Database,
  userId: number,
  createdByUserId: number,
  name: string,
): Promise<ProgramListItem> {
  const row = await db
    .prepare('INSERT INTO training_plan (user_id, name, created_by_user_id) VALUES (?, ?, ?) RETURNING id, position')
    .bind(userId, name, createdByUserId)
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
