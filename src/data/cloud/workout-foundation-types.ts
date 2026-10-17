import type { TrackingType } from '../../api';
import { isCoachExerciseDefinition } from '../exercises/coachExerciseTypes';
import type { PublicExercise } from '../exercises/publicExerciseTypes';
import type { ResistanceBandCode, SetLabel } from '../../workout/setEntryTypes';
import type { CloudSharedRow } from './database';

/** Canonical exercise identity. Keep a self-contained snapshot for coach-private
 * exercises that a client may not be able to query outside this relationship. */
export interface CloudProgramExerciseSnapshot {
  exerciseDefinitionId: string;
  scope: 'public' | 'coach' | 'client';
  name: string;
  nameEn: string | null;
  /** Legacy program records may contain this metadata. Program authoring and
   * projection deliberately ignore it; newly added program exercises omit it. */
  trackingType?: unknown;
  mediaUrl: string | null;
  /** Immutable full definition captured when a coach assigns a private exercise. */
  catalogueDefinition?: PublicExercise;
  /** Original author; must match the selected, accepted relationship coach. */
  catalogueCoachUserId?: string;
}

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

/** Scheduling is not a workout PLAN snapshot. Only a privileged Start freezes PLAN. */
export interface CloudWorkoutOccurrenceRow extends CloudSharedRow {
  coachUserId: string;
  clientUserId: string;
  programDayId: string;
  workoutSessionId: string | null;
  calendarDate: string;
  startMinute: number;
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
