import { describe, expect, it } from 'vitest';
import type { WorkoutOccurrencePlan } from './workout-occurrence-plan';
import { appendOccurrenceExercise, appendOccurrenceSet, occurrencePlanChanged, occurrenceTemplateChanged,
  removeOccurrenceExercise, removeOccurrenceSet, reorderOccurrenceExercises } from './workout-occurrence-edit';
const exercise = { exerciseDefinitionId: '0001', scope: 'public' as const,
  name: 'Приседания', nameEn: null, mediaUrl: null };
const empty: WorkoutOccurrencePlan = { name: 'День А', comment: null, exercises: [] };
describe('occurrence PLAN structured editing', () => {
  it('can add, remove and reorder exercises while leaving original immutable', () => {
    const a = appendOccurrenceExercise(empty, exercise);
    const b = appendOccurrenceExercise(a, { ...exercise, exerciseDefinitionId: '0002' });
    const reversed = reorderOccurrenceExercises(b, [b.exercises[1].id, b.exercises[0].id]);
    expect(reversed.exercises.map(ex => ex.position)).toEqual([0, 1]);
    expect(reversed.exercises[0].exercise.exerciseDefinitionId).toBe('0002');
    expect(removeOccurrenceExercise(reversed, reversed.exercises[0].id).exercises).toHaveLength(1);
    expect(empty.exercises).toHaveLength(0);
    expect(occurrencePlanChanged(reversed, empty)).toBe(true);
  });
  it('allows a blank plan set and removes it without modifying the source', () => {
    const base = appendOccurrenceExercise(empty, exercise);
    const id = base.exercises[0].id;
    const next = appendOccurrenceSet(base, id);
    expect(next.exercises[0].sets[0].plannedReps).toBeNull();
    expect(next.exercises[0].sets[0].plannedWeightKg).toBeNull();
    expect(removeOccurrenceSet(next, id, next.exercises[0].sets[0].id)).toEqual(base);
    expect(base.exercises[0].sets).toHaveLength(0);
  });
  it('copies the previous scheduled set including technique and numeric PLAN without reusing its identity', () => {
    const withExercise = appendOccurrenceExercise(empty, exercise);
    const exerciseId = withExercise.exercises[0].id;
    const withBlankSet = appendOccurrenceSet(withExercise, exerciseId);
    const filled: WorkoutOccurrencePlan = {
      ...withBlankSet,
      exercises: withBlankSet.exercises.map(ex => ({
        ...ex,
        sets: ex.sets.map(set => ({
          ...set, sourceProgramSetId: 'template-set-1',
          setType: 'cluster' as const, setLabel: 'easy' as const,
          comment: 'Медленная эксцентрика',
          materialLinks: ['material:1'], chatLinks: ['chat:1'],
          plannedWeightKg: 57, plannedReps: 19,
          plannedDurationSeconds: 0, plannedDistanceMeters: 250,
        })),
      })),
    };
    const added = appendOccurrenceSet(filled, exerciseId);
    const [previous, copy] = added.exercises[0].sets;
    expect(copy).toMatchObject({
      sourceProgramSetId: null, position: 1,
      setType: 'cluster', setLabel: 'easy',
      comment: 'Медленная эксцентрика',
      materialLinks: ['material:1'], chatLinks: ['chat:1'],
      plannedWeightKg: 57, plannedReps: 19,
      plannedDurationSeconds: 0, plannedDistanceMeters: 250,
    });
    expect(copy.id).not.toBe(previous.id);
    expect(copy.materialLinks).not.toBe(previous.materialLinks);
    expect(copy.chatLinks).not.toBe(previous.chatLinks);
    expect(filled.exercises[0].sets).toHaveLength(1);

    const editedSecond: WorkoutOccurrencePlan = {
      ...added, exercises: added.exercises.map(ex => ({
        ...ex, sets: ex.sets.map((set, index) => index === 1
          ? { ...set, plannedWeightKg: 60, plannedReps: 12, setType: 'dropset' as const }
          : set),
      })),
    };
    const again = appendOccurrenceSet(editedSecond, exerciseId);
    expect(again.exercises[0].sets[2]).toMatchObject({
      sourceProgramSetId: null, position: 2, plannedWeightKg: 60,
      plannedReps: 12, setType: 'dropset',
    });
    expect(new Set(again.exercises[0].sets.map(set => set.id)).size).toBe(3);
    expect(again.exercises[0].sets[2].materialLinks)
      .not.toBe(again.exercises[0].sets[1].materialLinks);
  });

  it('treats independent numeric PLAN edits as occurrence-only, never program changes', () => {
    const base = appendOccurrenceExercise(empty, exercise);
    const withSet = appendOccurrenceSet(base, base.exercises[0].id);
    const numericEdit: WorkoutOccurrencePlan = { ...withSet, exercises: withSet.exercises.map(ex => ({
      ...ex, sets: ex.sets.map(set => ({ ...set, plannedWeightKg: 80.75, plannedReps: 8 })),
    })) };
    expect(occurrencePlanChanged(numericEdit, withSet)).toBe(true);
    expect(occurrenceTemplateChanged(numericEdit, withSet)).toBe(false);
    const techniqueEdit: WorkoutOccurrencePlan = { ...numericEdit, exercises: numericEdit.exercises.map(ex => ({
      ...ex, sets: ex.sets.map(set => ({ ...set, setType: 'cluster' as const })),
    })) };
    expect(occurrenceTemplateChanged(techniqueEdit, withSet)).toBe(true);
    expect(withSet.exercises[0].sets[0].plannedWeightKg).toBeNull();
  });

  it('refuses omissions/duplication in reorder', () => {
    const value = appendOccurrenceExercise(empty, exercise);
    expect(() => reorderOccurrenceExercises(value, [])).toThrow();
    expect(() => reorderOccurrenceExercises(value, ['fake'])).toThrow();
  });
});
