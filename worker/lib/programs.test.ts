import { describe, expect, it, vi } from 'vitest';
import { listClientProgramsForCoach, listProgramsForUserByCoach } from './programs';

describe('program ownership queries', () => {
  it('lists a user programs only for the selected coach owner', async () => {
    const all = vi.fn().mockResolvedValue({ results: [] });
    const bind = vi.fn().mockReturnValue({ all });
    const prepare = vi.fn().mockReturnValue({ bind });
    const db = { prepare } as unknown as D1Database;

    await expect(listProgramsForUserByCoach(db, 7, 3)).resolves.toEqual([]);

    expect(prepare).toHaveBeenCalledWith(expect.stringContaining('tp.owner_coach_user_id = ?'));
    expect(bind).toHaveBeenCalledWith(7, 3);
  });

  it('groups only programs owned by the linked coach', async () => {
    const all = vi.fn().mockResolvedValue({
      results: [{
        id: 9,
        user_id: 7,
        owner_coach_user_id: 3,
        name: 'Силовая',
        status: 'draft',
        started_at: null,
        finished_at: null,
        position: 0,
        first_name: 'Анна',
        last_name: 'Иванова',
        username: 'anna',
        photo_url: null,
      }],
    });
    const bind = vi.fn().mockReturnValue({ all });
    const prepare = vi.fn().mockReturnValue({ bind });
    const db = { prepare } as unknown as D1Database;

    const groups = await listClientProgramsForCoach(db, 3);

    expect(prepare).toHaveBeenCalledWith(expect.stringContaining('cc.coach_user_id = programs.owner_coach_user_id'));
    expect(bind).toHaveBeenCalledWith(3);
    expect(groups).toEqual([{
      owner: {
        id: 7,
        firstName: 'Анна',
        lastName: 'Иванова',
        username: 'anna',
        photoUrl: null,
      },
      programs: [{
        id: 9,
        userId: 7,
        name: 'Силовая',
        status: 'draft',
        startedAt: null,
        finishedAt: null,
        position: 0,
      }],
    }]);
  });
});
