import type { CloudProgramDayOutline, CloudProgramPhaseRow, CloudWorkoutOccurrenceRow } from './workout-foundation-types';
import type { CloudTrainingPlanRow } from './database';
import { validateScheduleTiming } from './workout-scheduling-time';

import type { WorkoutOccurrencePlan } from '../../../shared/workout-occurrence-plan';
import { isWorkoutOccurrencePlan } from '../../../shared/workout-occurrence-plan';
export { isWorkoutOccurrencePlan } from '../../../shared/workout-occurrence-plan';
export type { WorkoutOccurrencePlan, OccurrencePlanExercise, OccurrencePlanSet } from '../../../shared/workout-occurrence-plan';

/** Editable domain view of a synchronized occurrence, including unpublished PLAN. */
export interface LocalWorkoutOccurrenceDraft {
  id: string;
  actorUserId: string;
  realmId: string;
  trainingPlanId?: string;
  programDayId?: string;
  autoCreatedProgram?: boolean;
  athleteUserId: string;
  coachUserId: string | null;
  clientUserId: string | null;
  format: 'independent' | 'coached';
  startsAtUtc: string;
  durationMinutes: number;
  plan: WorkoutOccurrencePlan;
  originalPlan: WorkoutOccurrencePlan;
  /** View of a saved occurrence. Only content edits change publication status to draft. */
  saved?: boolean;
  previouslyPublished?: boolean;
  targetOccurrenceId?: string;
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
          setType: set.setType ?? null, setLabel: set.setLabel ?? null, comment: set.comment ?? null,
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
  phaseStatus: CloudProgramPhaseRow['status'],
): LocalWorkoutOccurrenceDraft {
  validateScheduleTiming({ startsAtUtc, durationMinutes });
  if (plan.status !== 'active' || phaseStatus !== 'active'
    || plan.realmId !== outline.day.realmId || (format === 'coached' && !plan.coachUserId)
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

export function isLocalWorkoutOccurrenceDraft(value: unknown): value is LocalWorkoutOccurrenceDraft {
  if (!object(value) || typeof value.id !== 'string' || !value.id.startsWith('draft:')
    || (value.targetOccurrenceId !== undefined && (typeof value.targetOccurrenceId !== 'string' || !value.targetOccurrenceId))
    || !/^tg:[1-9]\d*$/.test(String(value.actorUserId))
    || !/^tg:[1-9]\d*$/.test(String(value.athleteUserId))
    || (value.coachUserId !== null && !/^tg:[1-9]\d*$/.test(String(value.coachUserId)))
    || (value.clientUserId !== null && !/^tg:[1-9]\d*$/.test(String(value.clientUserId)))
    || (value.saved !== undefined && typeof value.saved !== 'boolean')
    || typeof value.realmId !== 'string'
    || (value.trainingPlanId !== undefined && (typeof value.trainingPlanId !== 'string' || !value.trainingPlanId))
    || (value.programDayId !== undefined && (typeof value.programDayId !== 'string' || !value.programDayId))
    || Boolean(value.trainingPlanId) !== Boolean(value.programDayId)
    || (value.autoCreatedProgram !== undefined && typeof value.autoCreatedProgram !== 'boolean')
    || (value.autoCreatedProgram === true && !value.programDayId)
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

export function draftFromOccurrence(actorUserId: string, row: CloudWorkoutOccurrenceRow): LocalWorkoutOccurrenceDraft {
  const now = new Date().toISOString();
  return { id: 'draft:' + row.id, actorUserId, realmId: row.realmId, saved: row.publicationStatus !== 'draft',
    previouslyPublished: row.publicationStatus !== 'draft' || !!row.publishedPlan,
    targetOccurrenceId: row.id, trainingPlanId: row.trainingPlanId, programDayId: row.programDayId,
    autoCreatedProgram: row.autoCreatedProgram,
    athleteUserId: row.athleteUserId, coachUserId: row.coachUserId, clientUserId: row.clientUserId,
    format: row.format, startsAtUtc: row.startsAtUtc, durationMinutes: row.durationMinutes,
    plan: structuredClone(row.plan), originalPlan: structuredClone(row.originalPlan ?? row.plan), createdAt: now, updatedAt: now };
}
