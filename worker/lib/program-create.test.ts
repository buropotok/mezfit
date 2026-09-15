import { describe, expect, it, vi } from 'vitest';
import { createProgramForUser } from './program-create';

describe('createProgramForUser', () => {
  it('persists the owner and creator, appends the program and returns a draft', async () => {
    const first = vi.fn().mockResolvedValue({ id: 42, position: 4 });
    const bind = vi.fn().mockReturnValue({ first });
    const prepare = vi.fn().mockReturnValue({ bind });
    const db = { prepare } as unknown as D1Database;

    await expect(createProgramForUser(db, 7, 3, 'Силовая')).resolves.toEqual({
      id: 42,
      userId: 7,
      name: 'Силовая',
      status: 'draft',
      startedAt: null,
      finishedAt: null,
      position: 4,
    });
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining('owner_coach_user_id'));
    expect(bind).toHaveBeenCalledWith(7, 3, 'Силовая', 3, 7, 3);
  });
});
