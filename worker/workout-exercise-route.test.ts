import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addWorkoutExercise, listWorkoutExerciseOptions } from './lib/workout-exercise-actions';
import { handleWorkoutSessionRoute } from './lib/workout-session-api';

vi.mock('./lib/workout-exercise-actions', () => ({
  addWorkoutExercise: vi.fn(),
  listWorkoutExerciseOptions: vi.fn(),
}));

const listMock = vi.mocked(listWorkoutExerciseOptions);
const addMock = vi.mocked(addWorkoutExercise);
const db = {} as D1Database;

beforeEach(() => {
  listMock.mockReset();
  addMock.mockReset();
});

describe('workout exercise routes', () => {
  it('lists exercises for the authenticated workout user', async () => {
    listMock.mockResolvedValue([]);
    const request = new Request('https://mezfit.test/api/workout-sessions/exercises?search=press');

    const response = await handleWorkoutSessionRoute(request, db, 7);

    expect(response.status).toBe(200);
    expect(listMock).toHaveBeenCalledWith(db, 7, 'press');
    await expect(response.json()).resolves.toEqual({ exercises: [] });
  });

  it('adds an available exercise to an active owned workout', async () => {
    addMock.mockResolvedValue({
      kind: 'ok',
      session: {
        sessionId: 501,
        status: 'active',
        workoutDate: '2026-09-17',
        program: null,
        phase: null,
        day: null,
        exercises: [],
      },
    });
    const request = new Request('https://mezfit.test/api/workout-sessions/501/exercises', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ exerciseDefinitionId: 42 }),
    });

    const response = await handleWorkoutSessionRoute(request, db, 7);

    expect(response.status).toBe(201);
    expect(addMock).toHaveBeenCalledWith(db, 7, 501, 42);
  });

  it('rejects malformed exercise ids before persistence', async () => {
    const request = new Request('https://mezfit.test/api/workout-sessions/501/exercises', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ exerciseDefinitionId: 0 }),
    });

    const response = await handleWorkoutSessionRoute(request, db, 7);

    expect(response.status).toBe(400);
    expect(addMock).not.toHaveBeenCalled();
  });
});
