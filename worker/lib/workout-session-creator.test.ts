import { describe, expect, it, vi } from 'vitest';
import { getWorkoutSessionProjection } from './workout-sessions';

describe('getWorkoutSessionProjection creator identity', () => {
  it('projects the workout creator from the program owner/creator fallback', async () => {
    const headerFirst = vi.fn().mockResolvedValue({
      id: 501,
      occurrence_id: null,
      status: 'active',
      workout_date: '2026-10-07',
      program_id: 20,
      program_name: 'Силовой блок',
      phase_id: 30,
      phase_name: 'Фаза 1',
      day_id: 40,
      day_name: 'День B',
      day_position: 1,
      coach_user_id: 9,
      creator_user_id: 9,
      creator_first_name: 'Анна',
      creator_last_name: 'Тренер',
      creator_username: 'anna',
      creator_photo_url: 'https://example.com/coach.jpg',
    });
    const exercisesAll = vi.fn().mockResolvedValue({ results: [] });
    let projectionHeaderSql = '';
    const prepare = vi.fn((sql: string) => {
      if (sql.includes('FROM workout_session ws')) {
        projectionHeaderSql = sql;
        return { bind: vi.fn().mockReturnValue({ first: headerFirst }) };
      }
      if (sql.includes('FROM session_exercise se')) {
        return { bind: vi.fn().mockReturnValue({ all: exercisesAll }) };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const db = { prepare } as unknown as D1Database;

    await expect(getWorkoutSessionProjection(db, 7, 501)).resolves.toMatchObject({
      creator: {
        id: 9,
        firstName: 'Анна',
        lastName: 'Тренер',
        username: 'anna',
        photoUrl: 'https://example.com/coach.jpg',
      },
    });

    expect(projectionHeaderSql).toContain('LEFT JOIN app_user creator');
    expect(projectionHeaderSql).toContain(
      'COALESCE(tp.owner_coach_user_id, tp.created_by_user_id, ws.user_id)',
    );
  });
});
