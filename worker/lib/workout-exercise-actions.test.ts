import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addWorkoutExercise } from './workout-exercise-actions';
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

function createDb(options: { workoutStatus?: string | null; exerciseAvailable?: boolean } = {}) {
  const workoutStatus = options.workoutStatus === undefined ? 'active' : options.workoutStatus;
  const exerciseAvailable = options.exerciseAvailable ?? true;
  const sessionExerciseStatement = { kind: 'session-exercise-insert' };
  const sessionSetStatement = { kind: 'session-set-insert' };
  const batch = vi.fn().mockResolvedValue([]);

  const prepare = vi.fn((sql: string) => {
    if (sql.includes('FROM workout_session') && sql.includes('SELECT id, status')) {
      return {
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(workoutStatus === null ? null : { id: 501, status: workoutStatus }),
        }),
      };
    }
    if (sql.includes('FROM exercise_definition e') && sql.includes('SELECT e.id')) {
      return {
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(exerciseAvailable ? { id: 42 } : null),
        }),
      };
    }
    if (sql.includes('INSERT INTO session_exercise')) {
      return { bind: vi.fn().mockReturnValue(sessionExerciseStatement) };
    }
    if (sql.includes('INSERT INTO session_set')) {
      return { bind: vi.fn().mockReturnValue(sessionSetStatement) };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });

  return {
    db: { prepare, batch } as unknown as D1Database,
    batch,
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

describe('addWorkoutExercise', () => {
  it('creates the exercise and its first set in one D1 batch and returns the canonical projection', async () => {
    const { db, batch, sessionExerciseStatement, sessionSetStatement } = createDb();
    projectionMock.mockResolvedValue(canonicalSession);

    await expect(addWorkoutExercise(db, 7, 501, 42)).resolves.toEqual({
      kind: 'ok',
      session: canonicalSession,
    });

    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch).toHaveBeenCalledWith([sessionExerciseStatement, sessionSetStatement]);
    expect(projectionMock).toHaveBeenCalledWith(db, 7, 501);
  });

  it('does not mutate a workout that is not active', async () => {
    const { db, batch } = createDb({ workoutStatus: 'completed' });

    await expect(addWorkoutExercise(db, 7, 501, 42)).resolves.toEqual({ kind: 'invalid_state' });

    expect(batch).not.toHaveBeenCalled();
    expect(projectionMock).not.toHaveBeenCalled();
  });

  it('does not add an exercise outside the authenticated user visibility scope', async () => {
    const { db, batch } = createDb({ exerciseAvailable: false });

    await expect(addWorkoutExercise(db, 7, 501, 42)).resolves.toEqual({ kind: 'exercise_not_found' });

    expect(batch).not.toHaveBeenCalled();
    expect(projectionMock).not.toHaveBeenCalled();
  });
});
