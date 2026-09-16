import { describe, expect, it } from 'vitest';
import { createProgramSet } from './program-set-create';

describe('createProgramSet', () => {
  it('maps one-based set number to zero-based program_set position without workout state', async () => {
    const binds: unknown[] = [];
    const db = {
      prepare: () => ({
        bind: (...values: unknown[]) => {
          binds.push(...values);
          return {
            first: async () => ({
              id: 17,
              program_exercise_id: 4,
              position: 1,
              reps: 8,
              weight: 72.5,
              duration_seconds: null,
              distance_meters: null,
            }),
          };
        },
      }),
    } as unknown as D1Database;

    const result = await createProgramSet(db, 4, 9, {
      setNumber: 2,
      reps: 8,
      weightKg: 72.5,
      durationSeconds: null,
      distanceMeters: null,
    });

    expect(binds).toEqual([4, 1, 8, 72.5, null, null, 9]);
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

  it('returns null when the active set position already exists', async () => {
    const db = {
      prepare: () => ({
        bind: () => ({ first: async () => null }),
      }),
    } as unknown as D1Database;

    await expect(createProgramSet(db, 4, 9, {
      setNumber: 1,
      reps: null,
      weightKg: null,
      durationSeconds: null,
      distanceMeters: null,
    })).resolves.toBeNull();
  });
});
