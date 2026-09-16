import type { ExerciseDefinition } from '../api';
import type { ExistingSetFact, PreviousSet, SetEntryFactDraft, SetMetrics } from './setEntryTypes';

export type SessionExerciseStatus = 'planned' | 'active' | 'completed' | 'skipped' | 'inactive';
export type SessionSetStatus = 'pending' | 'completed' | 'skipped';

export interface SessionExerciseContext {
  workoutSessionId: number;
  workoutDate: string;
  program: {
    id: number;
    name: string;
  } | null;
}

export interface SessionExerciseSetData {
  sessionSetId: number;
  sourceProgramSetId: number | null;
  position: number;
  status: SessionSetStatus;
  plan: SetMetrics | null;
  previous: PreviousSet | null;
  fact: ExistingSetFact | null;
}

export interface SessionExerciseData {
  sessionExerciseId: number;
  workoutSessionId: number;
  sourceProgramExerciseId: number | null;
  position: number;
  status: SessionExerciseStatus;
  notes: string | null;
  exercise: ExerciseDefinition;
  sets: SessionExerciseSetData[];
}

export interface SaveSessionSetInput {
  workoutSessionId: number;
  sessionExerciseId: number;
  sessionSetId: number;
  fact: SetEntryFactDraft;
}

interface SessionExerciseSharedProps {
  context: SessionExerciseContext;
  data: SessionExerciseData;
  collapsed?: boolean;
  defaultCollapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  onOpenExerciseMenu: (sessionExerciseId: number) => void;
  onOpenHistory: (exerciseDefinitionId: number) => void;
  onOpenChat: () => void;
}

export type SessionExerciseProps =
  | (SessionExerciseSharedProps & {
      mode?: 'workout';
      onSaveSet: (input: SaveSessionSetInput) => Promise<void>;
    })
  | (SessionExerciseSharedProps & {
      mode: 'plan';
      programExerciseId: number;
      onPlanReconcile: () => void;
      onSaveSet?: never;
    });
