import { describe, expect, it } from 'vitest';
import { updateOccurrenceSetPlan, occurrenceStructureChanged, occurrencePlanChanged } from './workout-occurrence-edit';
import { snapshotProgramDay } from './workout-occurrence-plan';
import type { WorkoutOccurrencePlan } from './workout-occurrence-plan';
import type { CloudProgramDayOutline } from './workout-foundation-types';

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
  it('strips stale numeric fields when creating a dated workout from a program template', () => {
    const template = {
      day: { id: 'day', name: 'День 1', comment: null, category: null },
      exercises: [{
        exercise: { id: 'program-exercise', status: 'active', exercise: base.exercises[0].exercise,
          position: 0, notes: null },
        sets: [{
          id: 'program-set', status: 'active', position: 0,
          setType: 'cluster', comment: null, setLabel: null,
          materialLinks: [], chatLinks: [],
          plannedWeightKg: 123, plannedReps: 15,
          plannedDurationSeconds: 90, plannedDistanceMeters: 3500,
        }],
      }],
    } as unknown as CloudProgramDayOutline;
    const instance = snapshotProgramDay(template);
    expect(instance.exercises[0].sets[0]).toMatchObject({
      setType: 'cluster', plannedWeightKg: null, plannedReps: null,
      plannedDurationSeconds: null, plannedDistanceMeters: null,
    });
    expect(template.exercises[0].sets[0].plannedWeightKg).toBe(123);
  });

  it('changes only the selected occurrence, leaving both the template source and a sibling occurrence untouched', () => {
    const first = structuredClone(base);
    const second = structuredClone(base);
    const updated = updateOccurrenceSetPlan(first, 'exercise', 'set', {
      plannedWeightKg: 70.75, plannedReps: 8,
      plannedDurationSeconds: null, plannedDistanceMeters: null, setType: 'dropset',
    });
    expect(updated.exercises[0].sets[0]).toMatchObject({ plannedWeightKg: 70.75, plannedReps: 8, setType: 'dropset' });
    expect(occurrencePlanChanged(updated, first)).toBe(true);
    expect(occurrenceStructureChanged(updated, first)).toBe(false);
    const newStructure = { ...updated, exercises: [...updated.exercises, {
      ...updated.exercises[0], id: 'second', position: 1,
    }] };
    expect(occurrenceStructureChanged(newStructure, first)).toBe(true);
    expect(first).toEqual(base);
    expect(second).toEqual(base);
    expect(() => updateOccurrenceSetPlan(first, 'exercise', 'missing', {
      plannedWeightKg: 80, plannedReps: 5, plannedDurationSeconds: null,
      plannedDistanceMeters: null, setType: null,
    })).toThrow('OCCURRENCE_SET_NOT_FOUND');
  });
});
