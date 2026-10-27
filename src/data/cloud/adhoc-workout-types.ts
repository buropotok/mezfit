import { isWorkoutOccurrencePlan, type WorkoutOccurrencePlan } from './workout-occurrence-plan';
import { isSetType } from '../../../shared/set-type';
import { isWorkoutExerciseSnapshot } from './workout-foundation-types';
import type { SetEntryFactDraft } from '../../workout/setEntryTypes';
import type { CloudWorkoutExerciseSnapshot } from './workout-foundation-types';
import type { ResistanceBandCode, SetLabel, SetType } from '../../workout/setEntryTypes';

/** Ad-hoc execution is independent of scheduled PLAN and its protected lifecycle. */
export interface AdHocSessionRow {
  id: string;
  realmId: string;
  /** Shared: realmId sentinel; personal: authenticated actor. */
  owner: string;
  athleteUserId: string;
  coachUserId: string | null;
  clientUserId: string | null;
  creatorUserId: string;
  name: string;
  comment: string | null;
  /** Scheduled execution: immutable link and complete accepted PLAN. */
  occurrenceId?: string;
  occurrencePlan?: WorkoutOccurrencePlan;
  programId?: string;
  dayId?: string;
  programName: string | null;
  autoCreatedProgram: boolean;
  templateSaveDecision?: 'pending' | 'saved' | 'declined';
  startedAt: string;
  completedAt: string | null;
  status: 'active' | 'completed';
  createdAt: string;
  updatedAt: string;
}

export interface AdHocExerciseRow {
  id: string;
  realmId: string;
  owner: string;
  sessionId: string;
  occurrenceExerciseId?: string;
  position: number;
  /** Immutable identity, full snapshot and resolved tracking metadata. */
  exercise: CloudWorkoutExerciseSnapshot;
  notes: string | null;
  deletedAt: string | null;
}

/** FACT only. Numeric PLAN has no representation in these tables. */
export interface AdHocSetRow {
  id: string;
  realmId: string;
  owner: string;
  sessionId: string;
  exerciseId: string;
  occurrenceSetId?: string;
  position: number;
  deletedAt: string | null;
  setType: SetType | null;
  actualReps: number | null;
  actualWeightKg: number | null;
  actualDurationSeconds: number | null;
  actualDistanceMeters: number | null;
  setLabel: SetLabel | null;
  rpe: number | null;
  comment: string | null;
  bands: ResistanceBandCode[];
  setStatus: 'pending' | 'completed' | 'skipped';
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const user = (value: unknown): value is string => typeof value === 'string' && /^tg:[1-9]\d*$/.test(value);
const timestamp = (value: unknown): value is string => typeof value === 'string'
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const text = (value: unknown, max: number): boolean => typeof value === 'string' && value.length <= max;
const nullableText = (value: unknown, max: number): boolean => value === null || text(value, max);
const position = (value: unknown): boolean => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const number = (value: unknown): boolean => value === null
  || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
const integer = (value: unknown): boolean => value === null || position(value);
const label = (value: unknown): boolean => value === null
  || (typeof value === 'string' && ['warmup', 'easy', 'normal', 'hard', 'drop'].includes(value));
const rpe = (value: unknown): boolean => value === null
  || (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10);
const bands = (value: unknown): boolean => Array.isArray(value) && value.every(band =>
  typeof band === 'string' && ['yellow', 'red', 'green', 'blue', 'purple', 'black'].includes(band));

/** Safe diagnostic codes contain no record values or participant identifiers. */
export type AdHocSessionValidationIssue = 'ADHOC_INVALID_IDENTITY' | 'ADHOC_INVALID_PARTICIPANTS'
  | 'ADHOC_INVALID_TITLE' | 'ADHOC_INVALID_SOURCE' | 'ADHOC_INVALID_TIMESTAMPS' | 'ADHOC_INVALID_LIFECYCLE';

export function adHocSessionValidationIssue(value: unknown): AdHocSessionValidationIssue | null {
  if (!object(value) || !id(value.id) || !id(value.realmId) || value.owner !== value.realmId)
    return 'ADHOC_INVALID_IDENTITY';
  if (!user(value.athleteUserId) || !user(value.creatorUserId)
    || !(value.coachUserId === null || user(value.coachUserId))
    || !(value.clientUserId === null || user(value.clientUserId))) return 'ADHOC_INVALID_PARTICIPANTS';
  if (!(typeof value.name === 'string' && value.name.trim().length > 0 && value.name.length <= 120)
    || !nullableText(value.comment, 4000)) return 'ADHOC_INVALID_TITLE';
  if (!(value.programId === undefined || id(value.programId))
    || !(value.dayId === undefined || (id(value.dayId) && id(value.programId)))
    || !(value.programId === undefined ? value.programName === null
      : typeof value.programName === 'string' && value.programName.trim().length > 0 && value.programName.length <= 120)
    || typeof value.autoCreatedProgram !== 'boolean'
    || (value.autoCreatedProgram && !(id(value.programId) && id(value.dayId)))
    || !(value.occurrenceId === undefined ? value.occurrencePlan === undefined
      : id(value.occurrenceId) && isWorkoutOccurrencePlan(value.occurrencePlan) && !value.autoCreatedProgram)) return 'ADHOC_INVALID_SOURCE';
  if (!timestamp(value.startedAt) || !timestamp(value.createdAt) || !timestamp(value.updatedAt))
    return 'ADHOC_INVALID_TIMESTAMPS';
  if (!((value.status === 'active' && value.completedAt === null && value.templateSaveDecision === undefined)
    || (value.status === 'completed' && timestamp(value.completedAt)
      && (value.autoCreatedProgram
        ? typeof value.templateSaveDecision === 'string' && ['pending', 'saved', 'declined'].includes(value.templateSaveDecision)
        : value.templateSaveDecision === undefined)))) return 'ADHOC_INVALID_LIFECYCLE';
  return null;
}

export function isAdHocSessionRow(value: unknown): value is AdHocSessionRow {
  return adHocSessionValidationIssue(value) === null;
}

export function isAdHocExerciseRow(value: unknown): value is AdHocExerciseRow {
  return object(value) && id(value.id) && id(value.realmId) && value.owner === value.realmId
    && id(value.sessionId) && (value.occurrenceExerciseId === undefined || id(value.occurrenceExerciseId)) && position(value.position) && nullableText(value.notes, 4000)
    && (value.deletedAt === null || timestamp(value.deletedAt)) && isWorkoutExerciseSnapshot(value.exercise);
}

export function isAdHocSetRow(value: unknown): value is AdHocSetRow {
  return object(value) && id(value.id) && id(value.realmId) && value.owner === value.realmId
    && id(value.sessionId) && id(value.exerciseId) && (value.occurrenceSetId === undefined || id(value.occurrenceSetId)) && position(value.position)
    && (value.deletedAt === null || timestamp(value.deletedAt))
    && (value.setType === null || isSetType(value.setType))
    && integer(value.actualReps) && number(value.actualWeightKg)
    && integer(value.actualDurationSeconds) && number(value.actualDistanceMeters)
    && label(value.setLabel) && rpe(value.rpe) && nullableText(value.comment, 1000) && bands(value.bands)
    && typeof value.setStatus === 'string' && ['pending', 'completed', 'skipped'].includes(value.setStatus);
}

/** Same FACT value rules as result entry; storage identity is never part of the draft. */
export function isAdHocFactDraft(value: unknown): value is SetEntryFactDraft {
  return object(value) && object(value.metrics)
    && integer(value.metrics.reps) && number(value.metrics.weightKg)
    && integer(value.metrics.durationSeconds) && number(value.metrics.distanceMeters)
    && label(value.setLabel) && (value.setType == null || isSetType(value.setType))
    && rpe(value.rpe) && (value.comment === null || typeof value.comment === 'string') && bands(value.bands);
}
