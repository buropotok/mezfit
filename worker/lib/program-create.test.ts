import { describe, expect, it, vi } from 'vitest';
import { createProgramForUser } from './program-create';

describe('createProgramForUser', () => {
  it('persists the owner and creator and returns a draft program', async () => {
    const first = vi.fn().mockResolvedValue({ id: 42 });
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
    });
    expect(bind).toHaveBeenCalledWith(7, 'Силовая', 3);
  });
});
