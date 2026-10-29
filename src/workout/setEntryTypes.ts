import type { PlannedSet, TrackingType } from '../api';
import type { NavigationContext } from '../NavigationShell';
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
  sessionSetId: string | number | null;
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
  /** Register the editor as the active nested navigation surface. */
  onNavigationContextChange?: (context: NavigationContext | null) => void;
  onOpenHistory?: () => void;
  onOpenChat?: () => void;
  /** Explicit occurrence PLAN or session FACT deletion capability; never a program template. */
  onDeleteSet?: () => Promise<void>;
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
      mode: 'occurrence-plan';
      /** Assigned PLAN can be inspected without granting mutation rights. */
      readOnly?: boolean;
      onPlanSave: (input: Partial<SetMetrics> & { setType: SetType | null }) => Promise<void>;
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

/** Session projections may carry a FACT object before any measurement is recorded. */
export function hasSetMeasurements(metrics: SetMetrics | null | undefined): metrics is SetMetrics {
  return metrics != null && [metrics.weightKg, metrics.reps, metrics.durationSeconds, metrics.distanceMeters]
    .some(value => value !== null);
}

export function createSetEntryDraft(data: SetEntryData): SetEntryFactDraft {
  const factMetrics = data.fact?.metrics;
  return {
    metrics: { ...(hasSetMeasurements(factMetrics) ? factMetrics : data.plan ?? emptySetMetrics()) },
    setLabel: data.fact?.setLabel ?? null,
    setType: data.fact?.setType !== undefined ? data.fact.setType : data.setType ?? null,
    rpe: data.fact?.rpe ?? null,
    comment: data.fact?.comment ?? null,
    bands: [...(data.fact?.bands ?? [])],
  };
}

/** Compare the editable payload, not input gestures or object identity. */
export function sameSetEntryDraft(a: SetEntryFactDraft, b: SetEntryFactDraft): boolean {
  return a.metrics.weightKg === b.metrics.weightKg && a.metrics.reps === b.metrics.reps
    && a.metrics.durationSeconds === b.metrics.durationSeconds && a.metrics.distanceMeters === b.metrics.distanceMeters
    && a.setLabel === b.setLabel && (a.setType ?? null) === (b.setType ?? null)
    && a.rpe === b.rpe && a.comment === b.comment
    && a.bands.length === b.bands.length && a.bands.every((band, index) => band === b.bands[index]);
}
