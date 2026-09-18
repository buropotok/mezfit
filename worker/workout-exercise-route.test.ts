import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addWorkoutExercises, listWorkoutExerciseOptions } from './lib/workout-exercise-actions';
import { handleWorkoutSessionRoute } from './lib/workout-session-api';

vi.mock('./lib/workout-exercise-actions', () => ({
  addWorkoutExercises: vi.fn(),
  listWorkoutExerciseOptions: vi.fn(),
}));

const listMock = vi.mocked(listWorkoutExerciseOptions);
const addMock = vi.mocked(addWorkoutExercises);
const db = {} as D1Database;

beforeEach(() => {
  listMock.mockReset();
  addMock.mockReset();
});

describe('workout exercise routes', () => {
  it('lists exercises for the authenticated workout user inside an explicit category', async () => {
    listMock.mockResolvedValue([]);
    const request = new Request('https://mezfit.test/api/workout-sessions/exercises?category=chest');

    const response = await handleWorkoutSessionRoute(request, db, 7);

    expect(response.status).toBe(200);
    expect(listMock).toHaveBeenCalledWith(db, 7, 'chest');
    await expect(response.json()).resolves.toEqual({ exercises: [] });
  });

  it('rejects a catalogue request without a supported category', async () => {
    const request = new Request('https://mezfit.test/api/workout-sessions/exercises');

    const response = await handleWorkoutSessionRoute(request, db, 7);

    expect(response.status).toBe(400);
    expect(listMock).not.toHaveBeenCalled();
  });

  it('adds the confirmed exercise selection as one workout mutation', async () => {
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
      body: JSON.stringify({ exerciseDefinitionIds: [42, 43] }),
    });

    const response = await handleWorkoutSessionRoute(request, db, 7);

    expect(response.status).toBe(201);
    expect(addMock).toHaveBeenCalledWith(db, 7, 501, [42, 43]);
  });

  it('rejects empty, duplicate, or malformed selections before persistence', async () => {
    for (const exerciseDefinitionIds of [[], [42, 42], [0, 42]]) {
      const request = new Request('https://mezfit.test/api/workout-sessions/501/exercises', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ exerciseDefinitionIds }),
      });

      const response = await handleWorkoutSessionRoute(request, db, 7);
      expect(response.status).toBe(400);
    }

    expect(addMock).not.toHaveBeenCalled();
  });
});
