import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolvePublicWorkoutExerciseIds, addWorkoutExercises } from './lib/workout-exercise-actions';
import { handleWorkoutSessionRoute } from './lib/workout-session-api';

vi.mock('./lib/workout-exercise-actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/workout-exercise-actions')>();
  return { ...actual, addWorkoutExercises: vi.fn() };
});

const addMock = vi.mocked(addWorkoutExercises);
const request = (body: unknown) => new Request('https://mezfit.test/api/workout-sessions/501/exercises', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

function fakeDB(records: Array<{ id: number; reference_key: string }>) {
  const bound = vi.fn((...ids: string[]) => ({
    all: async () => ({ results: records.filter((r) => ids.includes(r.reference_key)) }),
  }));
  const prepare = vi.fn((_sql: string) => ({ bind: bound }));
  return { db: { prepare } as unknown as D1Database, prepare, bound };
}

beforeEach(() => addMock.mockReset());

describe('canonical public IDs to legacy workout mutation mapping', () => {
  it('preserves the selected order and uses the trusted media dataset identity', async () => {
    const { db, prepare, bound } = fakeDB([{ id: 91, reference_key: '0002' }, { id: 77, reference_key: '0001' }]);
    expect(await resolvePublicWorkoutExerciseIds(db, ['0001','0002'])).toEqual([77,91]);
    expect(prepare.mock.calls[0][0]).toContain("reference_source = 'github_exercises_dataset'");
    expect(prepare.mock.calls[0][0]).toContain("is_archived = 0");
    expect(bound).toHaveBeenCalledWith('0001','0002');
  });

  it('refuses missing or ambiguous references', async () => {
    expect(await resolvePublicWorkoutExerciseIds(fakeDB([{id: 1, reference_key:'0001'}]).db, ['0001','0002'])).toBeNull();
    expect(await resolvePublicWorkoutExerciseIds(fakeDB([{id: 1, reference_key:'0001'}, {id: 2, reference_key:'0001'}]).db, ['0001'])).toBeNull();
  });

  it('accepts a verified public selection through existing authorized workout mutation', async () => {
    const { db } = fakeDB([{ id: 91, reference_key: '0002' }, { id: 77, reference_key: '0001' }]);
    addMock.mockResolvedValue({ kind: 'ok', session: {
      sessionId: 501, status: 'active', workoutDate: '2026-10-14',
      occurrenceId:null, startedAt:null, completedAt:null, program:null, phase:null, day:null, exercises:[],
    } });
    const r = await handleWorkoutSessionRoute(request({ publicExerciseIds: ['0001','0002'] }), db, 7);
    expect(r.status).toBe(201);
    expect(addMock).toHaveBeenCalledWith(db,7,501,[77,91]);
  });

  it('rejects malformed public IDs without querying or changing workouts', async () => {
    const { db, prepare } = fakeDB([]);
    for (const bad of [[], ['../bad'], ['1'], ['0001','0001'], [1], Array(101).fill('0001')]) {
      const r = await handleWorkoutSessionRoute(request({ publicExerciseIds: bad }), db, 7);
      expect(r.status).toBe(400);
    }
    expect(prepare).not.toHaveBeenCalled();
    expect(addMock).not.toHaveBeenCalled();
  });

  it('does not call the workout mutation when source IDs are missing', async () => {
    const { db } = fakeDB([]);
    const r = await handleWorkoutSessionRoute(request({ publicExerciseIds: ['0001'] }), db, 7);
    expect(r.status).toBe(404);
    expect(addMock).not.toHaveBeenCalled();
  });
});
