import { isExerciseDefinition } from './exercise-definition';
import type { CloudProgramExerciseSnapshot } from './program-exercise-snapshot';
import type { SetLabel } from './set-label';
import { isSetType, type SetType } from './set-type';

export interface OccurrencePlanSet {
  setType?: SetType | null;
  id: string;
  sourceProgramSetId: string | null;
  position: number;
  setLabel: SetLabel | null;
  comment: string | null;
  materialLinks: string[];
  chatLinks: string[];
  plannedReps: number | null;
  plannedWeightKg: number | null;
  plannedDurationSeconds: number | null;
  plannedDistanceMeters: number | null;
}

export interface OccurrencePlanExercise {
  id: string;
  sourceProgramExerciseId: string | null;
  position: number;
  exercise: CloudProgramExerciseSnapshot;
  notes: string | null;
  sets: OccurrencePlanSet[];
}

/** Complete independent prescription for a single scheduled occurrence. */
export interface WorkoutOccurrencePlan {
  name: string;
  category?: string | null;
  comment: string | null;
  exercises: OccurrencePlanExercise[];
}

const object = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

export function isWorkoutOccurrencePlan(value: unknown): value is WorkoutOccurrencePlan {
  if (!object(value) || typeof value.name !== 'string'
    || value.name.length > 120 || !value.name.trim()
    || (value.category !== undefined && value.category !== null && typeof value.category !== 'string')
    || (value.comment !== null && typeof value.comment !== 'string')
    || !Array.isArray(value.exercises) || value.exercises.length > 100) return false;
  const exerciseIds = new Set<string>();
  return value.exercises.every((row: unknown, position: number) => {
    if (!object(row) || typeof row.id !== 'string' || !row.id
      || exerciseIds.has(row.id) || row.position !== position
      || (row.sourceProgramExerciseId !== null && typeof row.sourceProgramExerciseId !== 'string')
      || !object(row.exercise) || typeof row.exercise.exerciseDefinitionId !== 'string'
      || !row.exercise.exerciseDefinitionId
      || typeof row.exercise.name !== 'string' || !row.exercise.name.trim()
      || (row.exercise.nameEn !== null && typeof row.exercise.nameEn !== 'string')
      || (row.exercise.mediaUrl !== null && typeof row.exercise.mediaUrl !== 'string')
      || !['public', 'coach', 'client'].includes(String(row.exercise.scope))
      || (row.exercise.catalogueDefinition !== undefined
        && (!isExerciseDefinition(row.exercise.catalogueDefinition)
          || row.exercise.catalogueDefinition.id !== row.exercise.exerciseDefinitionId
          || typeof row.exercise.catalogueCoachUserId !== 'string'
          || !/^tg:[1-9]\d*$/.test(row.exercise.catalogueCoachUserId)))
      || (row.notes !== null && typeof row.notes !== 'string')
      || !Array.isArray(row.sets) || row.sets.length > 100) return false;
    exerciseIds.add(row.id);
    const setIds = new Set<string>();
    return row.sets.every((set: unknown, setPosition: number) => {
      if (!object(set) || typeof set.id !== 'string' || !set.id || setIds.has(set.id)
        || set.position !== setPosition
        || (set.sourceProgramSetId !== null && typeof set.sourceProgramSetId !== 'string')
      || (set.setType !== undefined && set.setType !== null && !isSetType(set.setType))
        || (set.comment !== null && typeof set.comment !== 'string')
        || (set.setLabel !== null && !['warmup', 'easy', 'normal', 'hard', 'drop'].includes(String(set.setLabel)))) return false;
      setIds.add(set.id);
      if (!['materialLinks', 'chatLinks'].every(field => Array.isArray(set[field])
        && (set[field] as unknown[]).every(item => typeof item === 'string'))) return false;
      return ['plannedReps', 'plannedWeightKg', 'plannedDurationSeconds', 'plannedDistanceMeters']
        .every(key => set[key] === null || (typeof set[key] === 'number'
          && Number.isFinite(set[key]) && (set[key] as number) >= 0));
    });
  });
}
