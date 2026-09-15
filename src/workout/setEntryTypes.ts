import type { TrackingType } from '../api';

export type SetLabel = 'warmup' | 'easy' | 'normal' | 'hard' | 'drop';

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

export interface SetEntryIdentity {
  programId: number;
  programName: string;
  exerciseDefinitionId: number;
  exerciseName: string;
  setNumber: number;
  workoutDate: string;
  sourceProgramSetId: number | null;
  sessionSetId: number | null;
}

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

export interface SetEntryProps {
  data: SetEntryData;
  onSave: (fact: SetEntryFactDraft) => Promise<void>;
  onOpenHistory: () => void;
  onOpenChat: () => void;
}

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
    rpe: data.fact?.rpe ?? null,
    comment: data.fact?.comment ?? null,
    bands: [...(data.fact?.bands ?? [])],
  };
}
