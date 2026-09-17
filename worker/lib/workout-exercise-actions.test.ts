import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addWorkoutExercises } from './workout-exercise-actions';
import { getWorkoutSessionProjection } from './workout-sessions';

vi.mock('./workout-sessions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./workout-sessions')>();
  return {
    ...actual,
    getWorkoutSessionProjection: vi.fn(),
  };
});

const projectionMock = vi.mocked(getWorkoutSessionProjection);

beforeEach(() => {
  projectionMock.mockReset();
});

function createDb(options: {
  insertedCount?: number;
  workoutStatus?: string | null;
  availableCount?: number;
} = {}) {
  const insertedCount = options.insertedCount ?? 2;
  const workoutStatus = options.workoutStatus === undefined ? 'active' : options.workoutStatus;
  const availableCount = options.availableCount ?? 2;
  const sessionExerciseStatement = { kind: 'session-exercise-insert' };
  const sessionSetStatement = { kind: 'session-set-insert' };
  const batch = vi.fn().mockResolvedValue([
    { meta: { changes: insertedCount } },
    { meta: { changes: insertedCount } },
  ]);
  const preparedSql: string[] = [];

  const prepare = vi.fn((sql: string) => {
    preparedSql.push(sql);
    if (sql.includes('INSERT INTO session_exercise')) {
      return { bind: vi.fn().mockReturnValue(sessionExerciseStatement) };
    }
    if (sql.includes('INSERT INTO session_set')) {
      return { bind: vi.fn().mockReturnValue(sessionSetStatement) };
    }
    if (sql.includes('SELECT status') && sql.includes('FROM workout_session')) {
      return {
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(workoutStatus === null ? null : { status: workoutStatus }),
        }),
      };
    }
    if (sql.includes('COUNT(DISTINCT e.id) AS count')) {
      return {
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({ count: availableCount }),
        }),
      };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });

  return {
    db: { prepare, batch } as unknown as D1Database,
    batch,
    preparedSql,
    sessionExerciseStatement,
    sessionSetStatement,
  };
}

const canonicalSession = {
  sessionId: 501,
  status: 'active' as const,
  workoutDate: '2026-09-17',
  program: null,
  phase: null,
  day: null,
  exercises: [],
};

describe('addWorkoutExercises', () => {
  it('guards active state and visibility in the actual insert and creates all initial sets in the same D1 batch', async () => {
    const { db, batch, preparedSql, sessionExerciseStatement, sessionSetStatement } = createDb();
    projectionMock.mockResolvedValue(canonicalSession);

    await expect(addWorkoutExercises(db, 7, 501, [42, 43])).resolves.toEqual({
      kind: 'ok',
      session: canonicalSession,
    });

    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch).toHaveBeenCalledWith([sessionExerciseStatement, sessionSetStatement]);
    expect(preparedSql[0]).toContain("status = 'active'");
    expect(preparedSql[0]).toContain('e.is_archived = 0');
    expect(preparedSql[0]).toContain('WHERE (SELECT COUNT(*) FROM eligible) = ?');
    expect(preparedSql[1]).toContain('WHERE changes() = ?');
    expect(projectionMock).toHaveBeenCalledWith(db, 7, 501);
  });

  it('does not create sets for a previous exercise when the guarded insert loses an active-state race', async () => {
    const { db, batch } = createDb({ insertedCount: 0, workoutStatus: 'completed' });

    await expect(addWorkoutExercises(db, 7, 501, [42, 43])).resolves.toEqual({ kind: 'invalid_state' });

    expect(batch).toHaveBeenCalledTimes(1);
    expect(projectionMock).not.toHaveBeenCalled();
  });

  it('rejects the whole confirmed selection when visibility changes before the guarded mutation', async () => {
    const { db, batch } = createDb({ insertedCount: 0, workoutStatus: 'active', availableCount: 1 });

    await expect(addWorkoutExercises(db, 7, 501, [42, 43])).resolves.toEqual({ kind: 'exercise_not_found' });

    expect(batch).toHaveBeenCalledTimes(1);
    expect(projectionMock).not.toHaveBeenCalled();
  });

  it('reports a missing owned workout after a rejected guarded insert', async () => {
    const { db } = createDb({ insertedCount: 0, workoutStatus: null });

    await expect(addWorkoutExercises(db, 7, 501, [42, 43])).resolves.toEqual({ kind: 'not_found' });
    expect(projectionMock).not.toHaveBeenCalled();
  });
});
