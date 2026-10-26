import type { CloudProgramExerciseSnapshot } from './workout-foundation-types';
import type { WorkoutOccurrencePlan, OccurrencePlanExercise, OccurrencePlanSet } from './workout-occurrence-plan';

function ordered<T extends { position: number }>(rows: readonly T[]): T[] {
  return rows.map((row, position) => ({ ...row, position }));
}

/** Immutable, locally persisted edit operations; never mutate the source ProgramDay. */
export function reorderOccurrenceExercises(
  plan: WorkoutOccurrencePlan, ids: readonly string[],
): WorkoutOccurrencePlan {
  if (ids.length !== plan.exercises.length || new Set(ids).size !== ids.length
    || !ids.every(id => plan.exercises.some(item => item.id === id)))
    throw new Error('INVALID_OCCURRENCE_EXERCISE_ORDER');
  return { ...plan, exercises: ordered(ids.map(id =>
    plan.exercises.find(item => item.id === id) as OccurrencePlanExercise)) };
}

export function appendOccurrenceExercise(
  plan: WorkoutOccurrencePlan, exercise: CloudProgramExerciseSnapshot,
): WorkoutOccurrencePlan {
  if (plan.exercises.length >= 100) throw new Error('OCCURRENCE_EXERCISE_LIMIT');
  return { ...plan, exercises: [...plan.exercises, {
    id: crypto.randomUUID(),
    sourceProgramExerciseId: null,
    exercise: structuredClone(exercise), notes: null, position: plan.exercises.length,
    sets: [],
  }] };
}

export function removeOccurrenceExercise(
  plan: WorkoutOccurrencePlan, id: string,
): WorkoutOccurrencePlan {
  if (!plan.exercises.some(ex => ex.id === id)) throw new Error('OCCURRENCE_EXERCISE_NOT_FOUND');
  return { ...plan, exercises: ordered(plan.exercises.filter(ex => ex.id !== id)) };
}

export function appendOccurrenceSet(
  plan: WorkoutOccurrencePlan, exerciseId: string,
): WorkoutOccurrencePlan {
  if (!plan.exercises.some(ex => ex.id === exerciseId)) throw new Error('OCCURRENCE_EXERCISE_NOT_FOUND');
  return { ...plan, exercises: plan.exercises.map(ex => {
    if (ex.id !== exerciseId) return ex;
    if (ex.sets.length >= 100) throw new Error('OCCURRENCE_SET_LIMIT');
    const previous = ex.sets.at(-1);
    const item: OccurrencePlanSet = {
      id: crypto.randomUUID(), sourceProgramSetId: null, position: ex.sets.length,
      setType: previous?.setType ?? null,
      setLabel: previous?.setLabel ?? null,
      comment: previous?.comment ?? null,
      materialLinks: [...(previous?.materialLinks ?? [])],
      chatLinks: [...(previous?.chatLinks ?? [])],
      plannedReps: previous?.plannedReps ?? null,
      plannedWeightKg: previous?.plannedWeightKg ?? null,
      plannedDurationSeconds: previous?.plannedDurationSeconds ?? null,
      plannedDistanceMeters: previous?.plannedDistanceMeters ?? null,
    };
    return { ...ex, sets: [...ex.sets, item] };
  }) };
}

export function removeOccurrenceSet(
  plan: WorkoutOccurrencePlan, exerciseId: string, setId: string,
): WorkoutOccurrencePlan {
  if (!plan.exercises.some(ex => ex.id === exerciseId && ex.sets.some(set => set.id === setId)))
    throw new Error('OCCURRENCE_SET_NOT_FOUND');
  return { ...plan, exercises: plan.exercises.map(ex => ex.id === exerciseId
    ? { ...ex, sets: ordered(ex.sets.filter(set => set.id !== setId)) } : ex) };
}

/** Program templates own structural recommendations, never occurrence metric prescriptions. */
export function occurrenceTemplateChanged(plan: WorkoutOccurrencePlan, original: WorkoutOccurrencePlan): boolean {
  const template = (value: WorkoutOccurrencePlan) => ({
    name: value.name, category: value.category ?? null, comment: value.comment,
    exercises: value.exercises.map(exercise => ({
      sourceProgramExerciseId: exercise.sourceProgramExerciseId,
      definitionId: exercise.exercise.exerciseDefinitionId,
      notes: exercise.notes,
      sets: exercise.sets.map(set => ({
        sourceProgramSetId: set.sourceProgramSetId, setType: set.setType ?? null,
        setLabel: set.setLabel, comment: set.comment,
        materialLinks: set.materialLinks, chatLinks: set.chatLinks,
      })),
    })),
  });
  return JSON.stringify(template(plan)) !== JSON.stringify(template(original));
}

/** Compare semantic prescription content, not transient local IDs. */
export function occurrencePlanChanged(plan: WorkoutOccurrencePlan,
  original: WorkoutOccurrencePlan): boolean {
  const normalized = (value: WorkoutOccurrencePlan) => ({
    name: value.name, category: value.category ?? null, comment: value.comment,
    exercises: value.exercises.map(item => ({
      sourceProgramExerciseId: item.sourceProgramExerciseId,
      definitionId: item.exercise.exerciseDefinitionId,
      notes: item.notes,
      sets: item.sets.map(set => ({
        sourceProgramSetId: set.sourceProgramSetId, setType: set.setType ?? null, setLabel: set.setLabel,
        comment: set.comment, materialLinks: set.materialLinks,
        chatLinks: set.chatLinks, plannedReps: set.plannedReps,
        plannedWeightKg: set.plannedWeightKg,
        plannedDurationSeconds: set.plannedDurationSeconds,
        plannedDistanceMeters: set.plannedDistanceMeters,
      })),
    })),
  });
  return JSON.stringify(normalized(plan)) !== JSON.stringify(normalized(original));
}
