import { describe, expect, it, vi } from 'vitest';
import { resetLegacyTestRelationship } from './test-legacy-relationship-reset';

describe('legacy test relationship reset', () => {
  it('uses a single D1 transaction with pair-scoped descending FK deletion', async () => {
    const statements: Array<{ sql: string; args: unknown[] }> = [];
    const batch = vi.fn(async (pending: typeof statements) => {
      expect(pending).toHaveLength(10);
      for (const statement of pending) {
        expect(statement.args).toEqual([41, 62]);
      }
      return [];
    });
    const db = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => {
          const statement = { sql, args };
          statements.push(statement);
          return statement;
        },
      }),
      batch,
    } as unknown as D1Database;
    await resetLegacyTestRelationship(db, 41, 62);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(statements.map(item => item.sql).join(' ')).not.toContain('DELETE FROM app_user');
    expect(statements.map(item => item.sql).join(' ')).not.toContain('DELETE FROM coach_client_invite');
    expect(statements.map(item => item.sql).join(' ')).toContain('owner_coach_user_id');
    expect(statements.map(item => item.sql).join(' ')).toContain('coach_user_id');
    expect(statements.map(item => item.sql).join(' ')).toContain('client_user_id');
    expect(statements.slice(0, 9).map(item =>
      item.sql.match(/DELETE FROM (\w+)/)?.[1])).toEqual([
      'session_set', 'session_exercise', 'workout_session', 'workout_occurrence',
      'program_set', 'program_exercise', 'program_day', 'program_phase', 'training_plan',
    ]);
    expect(statements[9].sql).toContain("status = 'inactive'");
  });

  it('does not claim success when the atomic batch rejects', async () => {
    const db = {
      prepare: (sql: string) => ({ bind: (...args: unknown[]) => ({ sql, args }) }),
      batch: async () => { throw new Error('D1 transaction failed'); },
    } as unknown as D1Database;
    await expect(resetLegacyTestRelationship(db, 41, 62)).rejects.toThrow('D1 transaction failed');
  });
});
