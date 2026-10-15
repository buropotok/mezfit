import type { TrackingType } from '../../api';
import type { ResistanceBandCode, SetLabel } from '../../workout/setEntryTypes';
import type { CloudSharedRow } from './database';

/** Canonical exercise identity. Keep a self-contained snapshot for coach-private
 * exercises that a client may not be able to query outside this relationship. */
export interface CloudWorkoutExerciseSnapshot {
  exerciseDefinitionId: string;
  scope: 'public' | 'coach' | 'client';
  name: string;
  nameEn: string | null;
  trackingType: TrackingType;
  mediaUrl: string | null;
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
export function isWorkoutExerciseSnapshot(value: unknown): value is CloudWorkoutExerciseSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;
  return typeof snapshot.exerciseDefinitionId === 'string' && snapshot.exerciseDefinitionId.length > 0
    && (snapshot.scope === 'public' || snapshot.scope === 'coach' || snapshot.scope === 'client')
    && typeof snapshot.name === 'string' && snapshot.name.trim().length > 0
    && (snapshot.nameEn === null || typeof snapshot.nameEn === 'string')
    && typeof snapshot.trackingType === 'string' && Object.hasOwn(TRACKING_TYPES, snapshot.trackingType)
    && (snapshot.mediaUrl === null || typeof snapshot.mediaUrl === 'string');
}

export interface CloudProgramPhaseRow extends CloudSharedRow {
  trainingPlanId: string;
  name: string;
  position: number;
  status: 'draft' | 'pending' | 'active' | 'finished' | 'cancelled';
  /** Suggested duration; does not imply dates or calendar scheduling. */
  durationWeeks?: number;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
}

export interface CloudProgramDayRow extends CloudSharedRow {
  programPhaseId: string;
  name: string;
  position: number;
  status: 'active' | 'deprecated';
}

export interface CloudProgramExerciseRow extends CloudSharedRow {
  programDayId: string;
  exercise: CloudWorkoutExerciseSnapshot;
  position: number;
  status: 'active' | 'deprecated';
  notes: string | null;
}

export interface CloudProgramSetRow extends CloudSharedRow {
  programExerciseId: string;
  position: number;
  status: 'active' | 'deprecated';
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

/** Read shape; write operations are deliberately absent until live ACL validation. */
export interface CloudProgramOutline {
  planId: string;
  realmId: string;
  phases: readonly {
    phase: CloudProgramPhaseRow;
    days: readonly {
      day: CloudProgramDayRow;
      exercises: readonly {
        exercise: CloudProgramExerciseRow;
        sets: readonly CloudProgramSetRow[];
      }[];
    }[];
  }[];
}
