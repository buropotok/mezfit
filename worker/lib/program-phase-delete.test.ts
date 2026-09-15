import { describe, expect, it, vi } from 'vitest';
import { deleteProgramPhase } from './program-phase-delete';

function createDb({ position = 1, inUse = 0 }: { position?: number; inUse?: number } = {}) {
  const preparedSql: string[] = [];
  const batch = vi.fn().mockResolvedValue([]);
  const prepare = vi.fn((sql: string) => {
    preparedSql.push(sql);
    return {
      bind: (..._args: unknown[]) => ({
        first: async () => {
          if (sql.includes('SELECT position')) return { position };
          if (sql.includes('AS in_use')) return { in_use: inUse };
          return null;
        },
      }),
    };
  });

  return {
    db: { prepare, batch } as unknown as D1Database,
    preparedSql,
    batch,
  };
}

describe('deleteProgramPhase', () => {
  it('deletes the planned phase tree and compacts later phase positions', async () => {
    const { db, preparedSql, batch } = createDb({ position: 1 });

    await expect(deleteProgramPhase(db, 5, 12)).resolves.toBe('deleted');

    expect(batch).toHaveBeenCalledTimes(1);
    const sql = preparedSql.join('\n');
    expect(sql).toContain('DELETE FROM program_set');
    expect(sql).toContain('DELETE FROM program_exercise');
    expect(sql).toContain('DELETE FROM program_day');
    expect(sql).toContain('DELETE FROM program_phase');
    expect(sql).toContain('position = position + 1000000');
    expect(sql).toContain('position = position - 1000001');
  });

  it('does not delete a phase referenced by workout history', async () => {
    const { db, batch } = createDb({ inUse: 1 });

    await expect(deleteProgramPhase(db, 5, 12)).resolves.toBe('in_use');
    expect(batch).not.toHaveBeenCalled();
  });
});
