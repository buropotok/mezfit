import { describe, expect, it, vi } from 'vitest';
import { duplicateProgram, reorderPrograms } from './program-actions';

describe('duplicateProgram', () => {
  it('creates the parent and child graph in one batch', async () => {
    const sourceFirst = vi.fn().mockResolvedValue({ id: 8, user_id: 7, name: 'Силовая' });
    const statements: object[] = [];
    const prepare = vi.fn((sql: string) => {
      if (sql.includes('SELECT id, user_id, name')) return { bind: vi.fn().mockReturnValue({ first: sourceFirst }) };
      return { bind: vi.fn().mockImplementation(() => {
        const statement = { sql };
        statements.push(statement);
        return statement;
      }) };
    });
    const batch = vi.fn().mockResolvedValue([{ results: [{ id: 42, position: 3 }] }, {}, {}, {}, {}]);
    const db = { prepare, batch } as unknown as D1Database;

    await expect(duplicateProgram(db, 8, 3)).resolves.toEqual({
      id: 42,
      userId: 7,
      name: 'Силовая (копия)',
      status: 'draft',
      startedAt: null,
      finishedAt: null,
      position: 3,
    });
    expect(statements).toHaveLength(5);
    expect(batch).toHaveBeenCalledOnce();
  });
});

describe('reorderPrograms', () => {
  it('rejects a partial owner list before changing persisted positions', async () => {
    const selectedAll = vi.fn().mockResolvedValue({ results: [{ id: 2 }, { id: 1 }] });
    const totalFirst = vi.fn().mockResolvedValue({ count: 3 });
    const prepare = vi.fn((sql: string) => {
      if (sql.includes('id IN')) return { bind: vi.fn().mockReturnValue({ all: selectedAll }) };
      if (sql.includes('COUNT(*)')) return { bind: vi.fn().mockReturnValue({ first: totalFirst }) };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const batch = vi.fn();
    const db = { prepare, batch } as unknown as D1Database;

    await expect(reorderPrograms(db, 7, [2, 1])).rejects.toThrow('INVALID_PROGRAM_ORDER');
    expect(batch).not.toHaveBeenCalled();
  });

  it('persists a complete ordered list in one batch', async () => {
    const selectedAll = vi.fn().mockResolvedValue({ results: [{ id: 2 }, { id: 1 }] });
    const totalFirst = vi.fn().mockResolvedValue({ count: 2 });
    const statements: object[] = [];
    const prepare = vi.fn((sql: string) => {
      if (sql.includes('id IN')) return { bind: vi.fn().mockReturnValue({ all: selectedAll }) };
      if (sql.includes('COUNT(*)')) return { bind: vi.fn().mockReturnValue({ first: totalFirst }) };
      return { bind: vi.fn().mockImplementation(() => {
        const statement = { sql };
        statements.push(statement);
        return statement;
      }) };
    });
    const batch = vi.fn().mockResolvedValue([]);
    const db = { prepare, batch } as unknown as D1Database;

    await expect(reorderPrograms(db, 7, [2, 1])).resolves.toBeUndefined();
    expect(statements).toHaveLength(3);
    expect(batch).toHaveBeenCalledOnce();
  });
});
