import { describe, expect, it } from 'vitest';
import { updateOccurrenceSetPlan } from './workout-occurrence-edit';
import { snapshotProgramDay } from './workout-occurrence-plan';
import type { WorkoutOccurrencePlan } from './workout-occurrence-plan';

const base: WorkoutOccurrencePlan = {
  name: 'Силовая', category: null, comment: null,
  exercises: [{
    id: 'exercise', sourceProgramExerciseId: 'program-exercise', position: 0,
    exercise: { exerciseDefinitionId: '1', name: 'Жим лёжа', nameEn: null, mediaUrl: null, scope: 'public' },
    notes: null, sets: [{
      id: 'set', sourceProgramSetId: 'program-set', position: 0,
      setType: null, setLabel: null, comment: null,
      materialLinks: [], chatLinks: [],
      plannedWeightKg: null, plannedReps: null, plannedDurationSeconds: null, plannedDistanceMeters: null,
    }],
  }],
};

describe('instance-only set PLAN ownership', () => {
  it('changes only the selected occurrence, leaving both the template source and a sibling occurrence untouched', () => {
    const first = structuredClone(base);
    const second = structuredClone(base);
    const updated = updateOccurrenceSetPlan(first, 'exercise', 'set', {
      plannedWeightKg: 70.75, plannedReps: 8,
      plannedDurationSeconds: null, plannedDistanceMeters: null, setType: 'dropset',
    });
    expect(updated.exercises[0].sets[0]).toMatchObject({ plannedWeightKg: 70.75, plannedReps: 8, setType: 'dropset' });
    expect(first).toEqual(base);
    expect(second).toEqual(base);
    expect(() => updateOccurrenceSetPlan(first, 'exercise', 'missing', {
      plannedWeightKg: 80, plannedReps: 5, plannedDurationSeconds: null,
      plannedDistanceMeters: null, setType: null,
    })).toThrow('OCCURRENCE_SET_NOT_FOUND');
  });
});
