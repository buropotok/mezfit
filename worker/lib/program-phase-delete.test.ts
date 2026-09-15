import { describe, expect, it, vi } from 'vitest';
import { deleteProgramPhase } from './program-phase-delete';

function createDb({ inUse = 0, targetMarked = true }: { inUse?: number; targetMarked?: boolean } = {}) {
  const preparedSql: string[] = [];
  const batch = vi.fn().mockResolvedValue([
    { meta: { changes: targetMarked ? 1 : 0 } },
  ]);
  const prepare = vi.fn((sql: string) => {
    preparedSql.push(sql);
    return {
      bind: (..._args: unknown[]) => ({
        first: async () => {
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
  it('deletes the planned phase tree and compacts later phase positions inside the atomic batch', async () => {
    const { db, preparedSql, batch } = createDb();

    await expect(deleteProgramPhase(db, 5, 12)).resolves.toBe('deleted');

    expect(batch).toHaveBeenCalledTimes(1);
    const sql = preparedSql.join('\n');
    expect(sql).toContain('DELETE FROM program_set');
    expect(sql).toContain('DELETE FROM program_exercise');
    expect(sql).toContain('DELETE FROM program_day');
    expect(sql).toContain('DELETE FROM program_phase');
    expect(sql).toContain('SET position = position + ?');
    expect(sql).toContain('SELECT position - ?');
    expect(sql).toContain('AND id != ?');
    expect(sql).toContain('SET position = position - ?');
    expect(sql).not.toContain('SELECT position\n    FROM program_phase');
  });

  it('does not compact when the target disappeared before the batch acquired the mutation slot', async () => {
    const { db, preparedSql } = createDb({ targetMarked: false });

    await expect(deleteProgramPhase(db, 5, 12)).resolves.toBe('not_found');

    const sql = preparedSql.join('\n');
    expect(sql).toContain('WHERE id = ? AND training_plan_id = ?');
    expect(sql).toContain('SELECT position - ?');
  });

  it('does not delete a phase referenced by workout history', async () => {
    const { db, batch } = createDb({ inUse: 1 });

    await expect(deleteProgramPhase(db, 5, 12)).resolves.toBe('in_use');
    expect(batch).not.toHaveBeenCalled();
  });
});
