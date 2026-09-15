import type { TrackingType } from '../api';

export type SetLabel = 'warmup' | 'easy' | 'normal' | 'hard' | 'drop';
export type SetEntryMode = 'workout' | 'plan';

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
  rpe: number | null;
  comment: string | null;
  bands: ResistanceBandCode[];
}

export type SetEntryProgramIdentity =
  | { programId: number; programName: string }
  | { programId: null; programName: null };

export type SetEntryIdentity = SetEntryProgramIdentity & {
  exerciseDefinitionId: number;
  exerciseName: string;
  setNumber: number;
  workoutDate: string;
  sourceProgramSetId: number | null;
  sessionSetId: number | null;
};

export interface SetEntryData {
  identity: SetEntryIdentity;
  trackingType: TrackingType;
  plan: SetMetrics | null;
  previous: PreviousSet | null;
  fact: ExistingSetFact | null;
}

export interface SetEntryFactDraft {
  metrics: SetMetrics;
  setLabel: SetLabel | null;
  rpe: number | null;
  comment: string | null;
  bands: ResistanceBandCode[];
}

interface SetEntryBaseProps {
  isOpen: boolean;
  data: SetEntryData;
  onClose: () => void;
  onOpenHistory: () => void;
  onOpenChat: () => void;
}

export type SetEntryProps =
  | (SetEntryBaseProps & {
      mode: 'workout';
      onSave: (fact: SetEntryFactDraft) => Promise<void>;
    })
  | (SetEntryBaseProps & {
      mode: 'plan';
      initData: string;
      programExerciseId: number;
      onSaved?: () => void;
    });

export function emptySetMetrics(): SetMetrics {
  return {
    weightKg: null,
    reps: null,
    durationSeconds: null,
    distanceMeters: null,
  };
}

export function createSetEntryDraft(data: SetEntryData, mode: SetEntryMode = 'workout'): SetEntryFactDraft {
  return {
    metrics: { ...(mode === 'plan' ? data.plan ?? emptySetMetrics() : data.fact?.metrics ?? data.plan ?? emptySetMetrics()) },
    setLabel: mode === 'plan' ? null : data.fact?.setLabel ?? null,
    rpe: mode === 'plan' ? null : data.fact?.rpe ?? null,
    comment: data.fact?.comment ?? null,
    bands: [...(data.fact?.bands ?? [])],
  };
}
