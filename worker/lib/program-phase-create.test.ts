import { describe, expect, it, vi } from 'vitest';
import { createProgramPhase } from './program-phase-create';

describe('createProgramPhase', () => {
  it('creates the next pending phase only for the program owner or explicit coach owner', async () => {
    const first = vi.fn().mockResolvedValue({
      id: 12,
      name: 'Базовая фаза',
      position: 2,
      status: 'pending',
      planned_start_date: null,
      planned_end_date: null,
      started_at: null,
      finished_at: null,
    });
    const bind = vi.fn(() => ({ first }));
    const prepare = vi.fn(() => ({ bind }));
    const db = { prepare } as unknown as D1Database;

    const phase = await createProgramPhase(db, 5, 3, 'Базовая фаза');

    expect(phase).toMatchObject({
      id: 12,
      name: 'Базовая фаза',
      position: 2,
      status: 'pending',
      completedExerciseCount: 0,
      exerciseCount: 0,
      progressPercent: 0,
      exercises: [],
    });
    expect(bind).toHaveBeenCalledWith('Базовая фаза', 3, 5, 3, 3);
    const sql = prepare.mock.calls[0]?.[0] as string;
    expect(sql).toContain('MAX(existing.position) + 1');
    expect(sql).toContain('plan.user_id = ? OR plan.owner_coach_user_id = ?');
    expect(sql).not.toContain('created_by_user_id = ?');
  });

  it('returns null when the program is not available to the actor', async () => {
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({ first: vi.fn().mockResolvedValue(null) })),
      })),
    } as unknown as D1Database;

    await expect(createProgramPhase(db, 5, 3, 'Фаза')).resolves.toBeNull();
  });
});
