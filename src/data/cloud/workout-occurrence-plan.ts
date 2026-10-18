import type { CloudProgramDayOutline, CloudProgramExerciseSnapshot } from './workout-foundation-types';
import type { CloudTrainingPlanRow } from './database';
import type { SetLabel } from '../../workout/setEntryTypes';
import { validateScheduleTiming } from './workout-scheduling-time';

export interface OccurrencePlanSet {
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

/** The only place where an unsaved occurrence is persisted: a local, unsynced table. */
export interface LocalWorkoutOccurrenceDraft {
  id: string;
  actorUserId: string;
  realmId: string;
  trainingPlanId: string;
  programDayId: string;
  athleteUserId: string;
  coachUserId: string | null;
  clientUserId: string | null;
  format: 'independent' | 'coached';
  startsAtUtc: string;
  durationMinutes: number;
  plan: WorkoutOccurrencePlan;
  originalPlan: WorkoutOccurrencePlan;
  createdAt: string;
  updatedAt: string;
}

function freshId(): string { return crypto.randomUUID(); }

/** Do not mutate the program graph while editing a scheduled workout. */
export function snapshotProgramDay(outline: CloudProgramDayOutline): WorkoutOccurrencePlan {
  return {
    name: outline.day.name,
    category: outline.day.category ?? null,
    comment: outline.day.comment ?? null,
    exercises: outline.exercises
      .filter(({ exercise }) => exercise.status === 'active')
      .map(({ exercise, sets }, position) => ({
        id: freshId(), sourceProgramExerciseId: exercise.id, position,
        exercise: structuredClone(exercise.exercise),
        notes: exercise.notes ?? null,
        sets: sets.filter(set => set.status === 'active').map((set, setPosition) => ({
          id: freshId(), sourceProgramSetId: set.id, position: setPosition,
          setLabel: set.setLabel ?? null, comment: set.comment ?? null,
          materialLinks: [...(set.materialLinks ?? [])], chatLinks: [...(set.chatLinks ?? [])],
          plannedReps: set.plannedReps, plannedWeightKg: set.plannedWeightKg,
          plannedDurationSeconds: set.plannedDurationSeconds,
          plannedDistanceMeters: set.plannedDistanceMeters,
        })),
      })),
  };
}

export function draftFromProgramDay(
  actorUserId: string, plan: CloudTrainingPlanRow, outline: CloudProgramDayOutline,
  format: 'independent' | 'coached', startsAtUtc: string, durationMinutes: number,
): LocalWorkoutOccurrenceDraft {
  validateScheduleTiming({ startsAtUtc, durationMinutes });
  if (plan.realmId !== outline.day.realmId || (format === 'coached' && !plan.coachUserId)
    || (actorUserId !== (plan.clientUserId ?? plan.athleteUserId)
      && actorUserId !== plan.coachUserId)
    || outline.day.status !== 'active') throw new Error('SCHEDULE_FORBIDDEN');
  const now = new Date().toISOString();
  const initialPlan = snapshotProgramDay(outline);
  return {
    id: 'draft:' + freshId(), actorUserId, realmId: plan.realmId,
    trainingPlanId: plan.id, programDayId: outline.day.id,
    athleteUserId: plan.clientUserId ?? actorUserId,
    coachUserId: plan.coachUserId, clientUserId: plan.clientUserId,
    format, startsAtUtc, durationMinutes,
    plan: structuredClone(initialPlan), originalPlan: initialPlan,
    createdAt: now, updatedAt: now,
  };
}

const object = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const bounded = (n: unknown, max: number): n is number =>
  Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) <= max;

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
      || typeof row.exercise.name !== 'string'
      || typeof row.exercise.scope !== 'string'
      || (row.notes !== null && typeof row.notes !== 'string')
      || !Array.isArray(row.sets) || row.sets.length > 100) return false;
    exerciseIds.add(row.id);
    const setIds = new Set<string>();
    return row.sets.every((set: unknown, setPosition: number) => {
      if (!object(set) || typeof set.id !== 'string' || !set.id || setIds.has(set.id)
        || set.position !== setPosition
        || (set.sourceProgramSetId !== null && typeof set.sourceProgramSetId !== 'string')
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

export function isLocalWorkoutOccurrenceDraft(value: unknown): value is LocalWorkoutOccurrenceDraft {
  if (!object(value) || typeof value.id !== 'string' || !value.id.startsWith('draft:')
    || !/^tg:[1-9]\d*$/.test(String(value.actorUserId))
    || typeof value.realmId !== 'string'
    || typeof value.trainingPlanId !== 'string'
    || typeof value.programDayId !== 'string'
    || typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string'
    || (value.format !== 'independent' && value.format !== 'coached')
    || !bounded(value.durationMinutes, 1440)
    || !isWorkoutOccurrencePlan(value.plan) || !isWorkoutOccurrencePlan(value.originalPlan)) return false;
  try {
    validateScheduleTiming({ startsAtUtc: String(value.startsAtUtc),
      durationMinutes: value.durationMinutes });
    return true;
  } catch { return false; }
}
