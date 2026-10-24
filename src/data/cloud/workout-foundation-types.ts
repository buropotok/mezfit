import { isCoachExerciseDefinition } from '../exercises/coachExerciseTypes';
import type { ExerciseTrackingType as TrackingType, PublicExercise } from '../exercises/publicExerciseTypes';
import type { ResistanceBandCode, SetLabel } from '../../workout/setEntryTypes';
import type { CloudSharedRow } from './database';
import type { WorkoutOccurrencePlan } from './workout-occurrence-plan';

import type { CloudProgramExerciseSnapshot } from '../../../shared/program-exercise-snapshot';
export type { CloudProgramExerciseSnapshot } from '../../../shared/program-exercise-snapshot';

/** Result entry belongs to a concrete workout, not its reusable program. */
export interface CloudWorkoutExerciseSnapshot extends CloudProgramExerciseSnapshot {
  trackingType: TrackingType;
}

/** Only a complete, self-contained relationship snapshot may populate 'Тренерские'. */
export function isAssignedCoachExerciseSnapshot(
  value: CloudProgramExerciseSnapshot,
  coachUserId: string,
): value is CloudProgramExerciseSnapshot & { catalogueDefinition: PublicExercise } {
  const candidate = value.catalogueDefinition;
  return value.scope === 'coach'
    && value.catalogueCoachUserId === coachUserId
    && typeof candidate === 'object' && candidate !== null
    && candidate.id === value.exerciseDefinitionId
    && isCoachExerciseDefinition({
      ...candidate, realmId: coachUserId, owner: coachUserId,
      sourceSha256: 'coach-custom', updatedAt: 'snapshot', archivedAt: null,
    }, coachUserId);
}

/** Keep the runtime values aligned with the shared TrackingType contract. */
const TRACKING_TYPES: Record<TrackingType, true> = {
  weight_reps: true,
  time: true,
  time_distance: true,
  time_reps: true,
  time_weight: true,
};

/** Synced IndexedDB records remain untrusted even when Dexie tables are typed. */
export function isProgramExerciseSnapshot(value: unknown): value is CloudProgramExerciseSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;
  return typeof snapshot.exerciseDefinitionId === 'string' && snapshot.exerciseDefinitionId.length > 0
    && (snapshot.scope === 'public' || snapshot.scope === 'coach' || snapshot.scope === 'client')
    && typeof snapshot.name === 'string' && snapshot.name.trim().length > 0
    && (snapshot.nameEn === null || typeof snapshot.nameEn === 'string')
    && (snapshot.mediaUrl === null || typeof snapshot.mediaUrl === 'string')
    && (snapshot.catalogueDefinition === undefined || (
      typeof snapshot.catalogueCoachUserId === 'string'
      && /^tg:[1-9]\d*$/.test(snapshot.catalogueCoachUserId)
      && isAssignedCoachExerciseSnapshot(value as CloudProgramExerciseSnapshot, snapshot.catalogueCoachUserId)
    ));
}

/** Executing/session snapshots retain the strict result-entry contract. */
export function isWorkoutExerciseSnapshot(value: unknown): value is CloudWorkoutExerciseSnapshot {
  return isProgramExerciseSnapshot(value)
    && typeof value.trackingType === 'string' && Object.hasOwn(TRACKING_TYPES, value.trackingType);
}

export interface CloudPlanChildRow extends Omit<CloudSharedRow, 'owner'> {
  /** Personal PLAN may be author-owned; new assigned PLAN descendants are ownerless. */
  owner: string | null;
}

export interface CloudProgramPhaseRow extends CloudPlanChildRow {
  deletedAt?: string | null;
  trainingPlanId: string;
  name: string;
  position: number;
  status: 'draft' | 'pending' | 'active' | 'finished' | 'cancelled';
  /** Suggested duration; does not imply dates or calendar scheduling. */
  durationWeeks?: number;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
}

export interface CloudProgramDayRow extends CloudPlanChildRow {
  programPhaseId: string;
  name: string;
  category?: string | null;
  comment?: string | null;
  position: number;
  status: 'active' | 'deprecated';
}

export interface CloudProgramExerciseRow extends CloudPlanChildRow {
  programDayId: string;
  exercise: CloudProgramExerciseSnapshot;
  position: number;
  status: 'active' | 'deprecated';
  notes: string | null;
}

export interface CloudProgramSetRow extends CloudPlanChildRow {
  programExerciseId: string;
  position: number;
  status: 'active' | 'deprecated';
  setLabel?: SetLabel | null;
  comment?: string | null;
  materialLinks?: string[];
  chatLinks?: string[];
  plannedReps: number | null;
  plannedWeightKg: number | null;
  plannedDurationSeconds: number | null;
  plannedDistanceMeters: number | null;
}

/** Each locally saved booking owns its PLAN snapshot, independent from the program template. */
export interface CloudWorkoutOccurrenceRow extends Omit<CloudSharedRow, 'owner'> {
  /** Realm ID is a truthy non-participant owner preserved by Addon 4.4.15. */
  owner: string | null;
  /** Calendar cancellation is separate from execution/session lifecycle status. */
  cancelledAt?: string | null;
  /** Publication is business state, independent from replication and execution. */
  publicationStatus?: 'draft' | 'published';
  draftAuthorUserId?: string;
  originalPlan?: WorkoutOccurrencePlan;
  publishedPlan?: WorkoutOccurrencePlan | null;
  /** Absent on legacy bookings: only an explicit personal_event is not a workout. */
  entryKind?: 'workout' | 'personal_event';
  /** Every PLAN edit, including a draft, is synchronized by Addon. */
  plan: WorkoutOccurrencePlan;
  /** Source provenance, independent of current cloud program availability. */
  trainingPlanId?: string;
  /** Assigned workouts have a coach; personal workouts do not. */
  coachUserId: string | null;
  /** Null only for personal programs; assigned records always identify the client. */
  clientUserId: string | null;
  athleteUserId: string;
  /** Absent for a workout authored outside a program. */
  programDayId?: string;
  /** Immutable provenance: first publication also fills the automatically created day. */
  autoCreatedProgram?: boolean;
  workoutSessionId: string | null;
  /** The scheduling contract requires an explicit workout format. */
  format: 'independent' | 'coached';
  /** Canonical UTC start; local calendar day is calculated by the viewer's device. */
  startsAtUtc: string;
  sourceRequestId?: string | null;
  /** Immutable submitted-command identity; not a comparison with mutable PLAN. */
  sourceRequestHash?: string;
  lastMutationId?: string;
  lastMutationHash?: string;
  createdByUserId?: string;
  createdAt?: string;
  updatedAt?: string;
  durationMinutes: number;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
}

/** Privileged immutable PLAN snapshot. Never editable through normal Coach/Client sync. */
export interface CloudSessionExerciseRow extends CloudSharedRow {
  workoutSessionId: string;
  sourceProgramExerciseId: string | null;
  exercise: CloudWorkoutExerciseSnapshot;
  position: number;
  notes: string | null;
}

/** FACT-only exercise; it cannot masquerade as a frozen PLAN exercise. */
export interface CloudSessionFactExerciseRow extends CloudSharedRow {
  workoutSessionId: string;
  source: 'fact_added';
  exercise: CloudWorkoutExerciseSnapshot;
  position: number;
  notes: string | null;
  createdByUserId: string;
  createdAt: string;
}

/** FACT-only set; immutable sessionSets and PLAN-derived FACT stay separate. */
export interface CloudSessionFactSetRow extends CloudSharedRow {
  workoutSessionId: string;
  sessionFactExerciseId: string;
  position: number;
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

export interface CloudProgramDayOutline {
  day: CloudProgramDayRow;
  exercises: readonly {
    exercise: CloudProgramExerciseRow;
    sets: readonly CloudProgramSetRow[];
  }[];
}

/** Typed PLAN projection, distinct from an executing workout session. */
export interface CloudProgramOutline {
  planId: string;
  realmId: string;
  phases: readonly {
    phase: CloudProgramPhaseRow;
    days: readonly CloudProgramDayOutline[];
  }[];
}
