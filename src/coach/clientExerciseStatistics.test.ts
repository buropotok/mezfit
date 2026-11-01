import { describe, expect, it } from 'vitest';
import type { ClientExerciseFact } from '../data/cloud/adhoc-workouts';
import {
  exerciseMetric, filterFacts, maxSetReps, maxWorkoutVolume,
  metricSeries, periodBounds, radarCategories, summarizeExercises,
} from './clientExerciseStatistics';

function fact(
  key: string, category: string, sessionId: string, startedAt: string,
  weight: number | null = 50, reps: number | null = 10,
): ClientExerciseFact {
  return {
    key, name: key, category, trackingType: 'weight_reps',
    mediaUrl: null, sessionId, sessionExerciseId: `${sessionId}-${key}`,
    startedAt,
    sets: [{ actualReps: reps, actualWeightKg: weight,
      actualDurationSeconds: null, actualDistanceMeters: null }],
  };
}

describe('client exercise FACT statistics', () => {
  const a = fact('public::press', 'chest', 's1', '2026-09-25T12:00:00.000Z');
  const b = fact('public::press', 'chest', 's2', '2026-10-28T12:00:00.000Z', 60, 8);
  const c = fact('public::squat', 'legs', 's2', '2026-10-28T12:00:00.000Z', 80, 5);

  it('counts each exercise once per training and retains the latest snapshot', () => {
    const duplicate = { ...b, sessionExerciseId: 'repeated-in-same-session' };
    const list = summarizeExercises([a, b, duplicate, c]);
    expect(list.find(row => row.key === a.key)).toMatchObject({
      name: b.name, workouts: 2, category: 'chest',
    });
    expect(radarCategories([a, b, duplicate, c])).toEqual([
      { category: 'chest', label: 'Грудь', count: 2 },
      { category: 'legs', label: 'Ноги', count: 1 },
    ]);
  });

  it('uses the same selected period for the list and chart', () => {
    const now = new Date('2026-11-01T12:00:00');
    const recent = filterFacts([a, b, c], '30d', now);
    expect(recent).toEqual([b, c]);
    expect(filterFacts([a, b, c], 'all', now)).toHaveLength(3);
    expect(periodBounds('month:2026-10', now)).toMatchObject({ label: 'октябрь 2026 г.' });
    expect(metricSeries(recent.filter(item => item.key === b.key), 'reps'))
      .toEqual([{ day: '10-28', value: 8 }]);
  });

  it('computes weight/reps metrics only from completed FACT set data', () => {
    expect(exerciseMetric([a, b], 'workouts')).toBe(2);
    expect(exerciseMetric([a, b], 'sets')).toBe(2);
    expect(exerciseMetric([a, b], 'reps')).toBe(18);
    expect(exerciseMetric([a, b], 'volume')).toBe(980);
    expect(exerciseMetric([a, b], 'weight')).toBe(60);
    expect(maxWorkoutVolume([a, b])).toBe(500);
    expect(maxSetReps([a, b])).toBe(10);
    expect(exerciseMetric([fact('one', 'chest', 's3', '2026-10-28T12:00:00.000Z', 80, 1)], 'oneRepMax')).toBe(80);
    expect(exerciseMetric([fact('none', 'chest', 's4', '2026-10-28T12:00:00.000Z', 80, null)], 'oneRepMax')).toBe(0);
  });

  it('keeps time and distance independent of weight/reps', () => {
    const timed: ClientExerciseFact = {
      ...b, trackingType: 'time_distance', sets: [{
        actualReps: null, actualWeightKg: null,
        actualDurationSeconds: 125, actualDistanceMeters: 550,
      }],
    };
    expect(exerciseMetric([timed], 'duration')).toBe(125);
    expect(exerciseMetric([timed], 'distance')).toBe(550);
    expect(exerciseMetric([timed], 'volume')).toBe(0);
  });
});
