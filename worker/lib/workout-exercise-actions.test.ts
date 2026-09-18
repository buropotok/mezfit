import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addWorkoutExercises, listWorkoutExerciseOptions } from './workout-exercise-actions';
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

interface ExerciseOptionDbRow {
  id: number;
  scope: 'global' | 'coach' | 'client';
  name: string;
  description: string | null;
  tracking_type: 'weight_reps';
  category_code: 'chest';
  equipment_code: 'barbell';
  reference_source: string | null;
  reference_key: string | null;
  reference_media_url: string | null;
}

function createDb(options: {
  insertedCount?: number;
  setCount?: number;
  workoutStatus?: string | null;
  availableCount?: number;
  exerciseRows?: ExerciseOptionDbRow[];
} = {}) {
  const insertedCount = options.insertedCount ?? 2;
  const setCount = options.setCount ?? insertedCount;
  const workoutStatus = options.workoutStatus === undefined ? 'active' : options.workoutStatus;
  const availableCount = options.availableCount ?? 2;
  const exerciseRows = options.exerciseRows ?? [];
  const sessionExerciseStatement = { kind: 'session-exercise-insert' };
  const sessionSetStatement = { kind: 'session-set-insert' };
  const batch = vi.fn().mockResolvedValue([
    { meta: { changes: insertedCount } },
    { meta: { changes: setCount } },
  ]);
  const preparedSql: string[] = [];
  const bindCalls: Array<{ sql: string; args: unknown[] }> = [];

  const prepare = vi.fn((sql: string) => {
    preparedSql.push(sql);
    if (sql.includes('FROM exercise_definition e') && sql.includes("COALESCE(e.category_code, 'other')")) {
      return {
        bind: vi.fn((...args: unknown[]) => {
          bindCalls.push({ sql, args });
          return { all: vi.fn().mockResolvedValue({ results: exerciseRows }) };
        }),
      };
    }
    if (sql.includes('INSERT INTO session_exercise')) {
      return {
        bind: vi.fn((...args: unknown[]) => {
          bindCalls.push({ sql, args });
          return sessionExerciseStatement;
        }),
      };
    }
    if (sql.includes('INSERT INTO session_set')) {
      return {
        bind: vi.fn((...args: unknown[]) => {
          bindCalls.push({ sql, args });
          return sessionSetStatement;
        }),
      };
    }
    if (sql.includes('SELECT status') && sql.includes('FROM workout_session')) {
      return {
        bind: vi.fn((...args: unknown[]) => {
          bindCalls.push({ sql, args });
          return {
            first: vi.fn().mockResolvedValue(workoutStatus === null ? null : { status: workoutStatus }),
          };
        }),
      };
    }
    if (sql.includes('COUNT(DISTINCT e.id) AS count')) {
      return {
        bind: vi.fn((...args: unknown[]) => {
          bindCalls.push({ sql, args });
          return {
            first: vi.fn().mockResolvedValue({ count: availableCount }),
          };
        }),
      };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });

  return {
    db: { prepare, batch } as unknown as D1Database,
    batch,
    bindCalls,
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

const benchPressRow: ExerciseOptionDbRow = {
  id: 42,
  scope: 'global',
  name: 'Жим лёжа',
  description: 'Базовое упражнение',
  tracking_type: 'weight_reps',
  category_code: 'chest',
  equipment_code: 'barbell',
  reference_source: null,
  reference_key: null,
  reference_media_url: null,
};

describe('listWorkoutExerciseOptions', () => {
  it('loads the visible catalogue rows for one category without a search query', async () => {
    const { db, bindCalls, preparedSql } = createDb({ exerciseRows: [benchPressRow] });

    await expect(listWorkoutExerciseOptions(db, 7, 'chest')).resolves.toEqual([
      expect.objectContaining({ id: 42, name: 'Жим лёжа' }),
    ]);

    expect(preparedSql[0]).toContain("COALESCE(e.category_code, 'other') = ?");
    expect(preparedSql[0]).not.toContain('LIKE');
    expect(bindCalls[0]?.args).toEqual([7, 7, 7, 'chest']);
  });
});

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
