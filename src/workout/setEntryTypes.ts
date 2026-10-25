import type { PlannedSet, TrackingType } from '../api';
import type { SetType } from '../../shared/set-type';

import type { SetLabel } from '../../shared/set-label';
export type { SetLabel } from '../../shared/set-label';
export type { SetType } from '../../shared/set-type';

export type ResistanceBandCode = 'yellow' | 'red' | 'green' | 'blue' | 'purple' | 'black';

export interface SetMetrics {
  weightKg: number | null;
  reps: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
}

export interface PreviousSet {
  workoutDate: string;
  metrics: SetMetrics;
}

export interface ExistingSetFact {
  metrics: SetMetrics;
  setLabel: SetLabel | null;
  setType?: SetType | null;
  rpe: number | null;
  comment: string | null;
  bands: ResistanceBandCode[];
}

export type SetEntryProgramIdentity =
  | { programId: string | number; programName: string }
  | { programId: null; programName: null };

export type SetEntryIdentity = SetEntryProgramIdentity & {
  exerciseDefinitionId: number | string;
  exerciseName: string;
  setNumber: number;
  workoutDate: string;
  sourceProgramSetId: number | string | null;
  sessionSetId: number | null;
};

export interface SetEntryData {
  identity: SetEntryIdentity;
  trackingType: TrackingType;
  setType?: SetType | null;
  plan: SetMetrics | null;
  previous: PreviousSet | null;
  fact: ExistingSetFact | null;
}

export interface SetEntryFactDraft {
  metrics: SetMetrics;
  setLabel: SetLabel | null;
  setType?: SetType | null;
  rpe: number | null;
  comment: string | null;
  bands: ResistanceBandCode[];
}

interface SetEntrySharedProps {
  isOpen: boolean;
  data: SetEntryData;
  onClose: () => void;
  onOpenHistory?: () => void;
  onOpenChat?: () => void;
}

export type SetEntryProps =
  | (SetEntrySharedProps & {
      mode?: 'workout';
      onSave: (fact: SetEntryFactDraft) => Promise<void>;
    })
  | (SetEntrySharedProps & {
      mode: 'plan';
      programExerciseId: number;
      onPlanSaved?: (set: PlannedSet) => void;
      onSave?: never;
    })
  | (SetEntrySharedProps & {
      mode: 'program-plan';
      onPlanSave: (input: { weightKg: number | null; reps: number | null; setType: SetType | null }) => Promise<void>;
      onSave?: never;
    });

export function emptySetMetrics(): SetMetrics {
  return {
    weightKg: null,
    reps: null,
    durationSeconds: null,
    distanceMeters: null,
  };
}

export function createSetEntryDraft(data: SetEntryData): SetEntryFactDraft {
  return {
    metrics: { ...(data.fact?.metrics ?? data.plan ?? emptySetMetrics()) },
    setLabel: data.fact?.setLabel ?? null,
    setType: data.fact?.setType !== undefined ? data.fact.setType : data.setType ?? null,
    rpe: data.fact?.rpe ?? null,
    comment: data.fact?.comment ?? null,
    bands: [...(data.fact?.bands ?? [])],
  };
}
