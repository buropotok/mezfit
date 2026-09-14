import { describe, expect, it, vi } from 'vitest';
import { createProgramForUser } from './program-create';

describe('createProgramForUser', () => {
  it('persists the owner and creator, appends the program and returns a draft', async () => {
    const insertFirst = vi.fn().mockResolvedValue({ id: 42 });
    const insertBind = vi.fn().mockReturnValue({ first: insertFirst });
    const positionFirst = vi.fn().mockResolvedValue({ position: 4 });
    const positionBind = vi.fn().mockReturnValue({ first: positionFirst });
    const prepare = vi.fn()
      .mockReturnValueOnce({ bind: insertBind })
      .mockReturnValueOnce({ bind: positionBind });
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
    expect(insertBind).toHaveBeenCalledWith(7, 'Силовая', 3);
    expect(positionBind).toHaveBeenCalledWith(7, 42, 42);
  });
});
