import { describe, expect, it } from 'vitest';
import { createProgramSet } from './program-set-create';

describe('createProgramSet', () => {
  it('maps the authored plan metrics to program_set columns', async () => {
    const binds: unknown[] = [];
    const db = {
      prepare: () => ({
        bind: (...values: unknown[]) => {
          binds.push(...values);
          return {
            first: async () => ({
              id: 17,
              program_exercise_id: 4,
              set_number: 2,
              reps: 8,
              weight: 72.5,
              duration_seconds: null,
              distance_meters: null,
            }),
          };
        },
      }),
    } as unknown as D1Database;

    const result = await createProgramSet(db, 4, {
      setNumber: 2,
      reps: 8,
      weightKg: 72.5,
      durationSeconds: null,
      distanceMeters: null,
    });

    expect(binds).toEqual([4, 2, 8, 72.5, null, null]);
    expect(result).toEqual({
      id: 17,
      programExerciseId: 4,
      setNumber: 2,
      reps: 8,
      weightKg: 72.5,
      durationSeconds: null,
      distanceMeters: null,
    });
  });
});
