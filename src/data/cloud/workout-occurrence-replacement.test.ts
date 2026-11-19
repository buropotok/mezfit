import { describe, expect, it } from 'vitest';
import type { WorkoutOccurrencePlan } from './workout-occurrence-plan';
import { replaceOccurrenceExercise } from './workout-occurrence-edit';

const original: WorkoutOccurrencePlan = {
  name: 'День', category: null, comment: null,
  exercises: [
    {
      id: 'old', sourceProgramExerciseId: 'source-exercise', position: 0, notes: 'Техника',
      exercise: { exerciseDefinitionId: '0001', scope: 'public', name: 'Первое', nameEn: null, mediaUrl: null },
      sets: [
        { id: 'set-1', sourceProgramSetId: 'source-set-1', position: 0,
          setType: 'cluster', setLabel: 'hard', comment: 'Темп', materialLinks: ['video'],
          chatLinks: ['chat'], plannedWeightKg: 65, plannedReps: 8,
          plannedDurationSeconds: null, plannedDistanceMeters: null },
        { id: 'set-2', sourceProgramSetId: 'source-set-2', position: 1,
          setType: null, setLabel: null, comment: null, materialLinks: [], chatLinks: [],
          plannedWeightKg: 55, plannedReps: 12, plannedDurationSeconds: null, plannedDistanceMeters: null },
      ],
    },
    {
      id: 'other', sourceProgramExerciseId: null, position: 1, notes: null,
      exercise: { exerciseDefinitionId: '0003', scope: 'public', name: 'Третье', nameEn: null, mediaUrl: null },
      sets: [],
    },
  ],
};

describe('scheduled workout exercise replacement', () => {
  const selected = { exerciseDefinitionId: '0002', scope: 'public' as const, name: 'Второе',
    nameEn: null, mediaUrl: null };
  it('transfers set order, entered prescription and technique, but not source identities', () => {
    const next = replaceOccurrenceExercise(original, 'old', selected, true);
    expect(next.exercises).toHaveLength(2);
    expect(next.exercises[1]).toEqual(original.exercises[1]);
    expect(next.exercises[0].id).not.toBe('old');
    expect(next.exercises[0].position).toBe(0);
    expect(next.exercises[0].exercise.exerciseDefinitionId).toBe('0002');
    expect(next.exercises[0].notes).toBe('Техника');
    expect(next.exercises[0].sourceProgramExerciseId).toBeNull();
    expect(next.exercises[0].sets.map(item => item.plannedReps)).toEqual([8, 12]);
    expect(next.exercises[0].sets.map(item => item.plannedWeightKg)).toEqual([65, 55]);
    expect(next.exercises[0].sets.map(item => item.sourceProgramSetId)).toEqual([null, null]);
    expect(next.exercises[0].sets.map(item => item.id)).not.toContain('set-1');
    expect(original.exercises[0].exercise.exerciseDefinitionId).toBe('0001');
  });
  it('discards values when not preserving, creating exactly one empty approach', () => {
    const next = replaceOccurrenceExercise(original, 'old', selected, false);
    const exercise = next.exercises[0];
    expect(exercise.notes).toBeNull();
    expect(exercise.sets).toHaveLength(1);
    expect(exercise.sets[0]).toMatchObject({
      plannedReps: null, plannedWeightKg: null,
      plannedDurationSeconds: null, plannedDistanceMeters: null,
      comment: null, setType: null, materialLinks: [], chatLinks: [],
    });
    expect(original.exercises[0].sets).toHaveLength(2);
  });
  it('does not replace a stale exercise selection', () => {
    expect(() => replaceOccurrenceExercise(original, 'missing', selected, false))
      .toThrow('OCCURRENCE_EXERCISE_NOT_FOUND');
  });
});
