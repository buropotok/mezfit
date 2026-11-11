import type { EntityDiscussionTarget, OpenEntityDiscussion } from '../discussions/entity-discussion-target';
import type { DiscussionAnchor, DiscussionScope } from '../../shared/discussion-anchor';
import type { NavigationContext } from '../NavigationShell';
import type { CloudProgramDayOutline } from '../data/cloud/workout-foundation-types';
import type { ExerciseDefinition } from '../api';
import type { ExistingSetFact, PreviousSet, SetEntryFactDraft, SetMetrics } from './setEntryTypes';
import type { SetType } from '../../shared/set-type';

export type SessionExerciseStatus = 'planned' | 'active' | 'completed' | 'skipped' | 'inactive';
export type SessionSetStatus = 'pending' | 'completed' | 'skipped';

export interface SessionExerciseContext<Id extends string | number = number> {
  workoutSessionId: Id;
  workoutDate: string;
  program: {
    id: Id;
    name: string;
  } | null;
}

export interface SessionExerciseSetData<Id extends string | number = number> {
  /** Repository-validated canonical identity; never a source program ID. */
  discussionAnchor?: DiscussionAnchor;
  sessionSetId: Id;
  sourceProgramSetId: Id | null;
  position: number;
  status: SessionSetStatus;
  setType?: SetType | null;
  plan: SetMetrics | null;
  previous: PreviousSet | null;
  fact: ExistingSetFact | null;
}

export interface SessionExerciseData<Id extends string | number = number> {
  discussionAnchor?: DiscussionAnchor;
  sessionExerciseId: Id;
  workoutSessionId: Id;
  sourceProgramExerciseId: Id | null;
  position: number;
  status: SessionExerciseStatus;
  notes: string | null;
  exercise: Omit<ExerciseDefinition, 'id'> & { id: Id };
  mediaUrl?: string | null;
  showPreviousPlaceholder?: boolean;
  sets: SessionExerciseSetData<Id>[];
}

export interface SaveSessionSetInput<Id extends string | number = number> {
  workoutSessionId: Id;
  sessionExerciseId: Id;
  sessionSetId: Id;
  fact: SetEntryFactDraft;
}

interface SessionExerciseSharedProps<Id extends string | number = number> {
  discussionScope?: DiscussionScope;
  onOpenDiscussion?: OpenEntityDiscussion;
  context: SessionExerciseContext<Id>;
  data: SessionExerciseData<Id>;
  collapsed?: boolean;
  defaultCollapsed?: boolean;
  surface?: 'default' | 'transparent';
  onCollapsedChange?: (collapsed: boolean) => void;
  editable?: boolean;
  /** Exact set identity to emphasize when arriving from an entity discussion. */
  focusSetId?: Id;
  focusReady?: boolean;
  onAddSet?: (sessionExerciseId: Id) => void;
  onDeleteSet?: (sessionSetId: Id) => Promise<void>;
  onOpenExerciseMenu?: (sessionExerciseId: Id) => void;
  onDeleteExercise?: (sessionExerciseId: Id) => void;
  onInformation?: () => void;
  onOpenHistory?: (exerciseDefinitionId: Id) => void;
  onOpenChat?: () => void;
  onNavigationContextChange?: (context: NavigationContext | null) => void;
  /** Dedicated Back owner for the FACT set-row delete confirmation. */
  onSetDeletionNavigationContextChange?: (context: NavigationContext | null) => void;
}

export type WorkoutSessionExerciseProps<Id extends string | number = number> =
  | (SessionExerciseSharedProps<Id> & {
      mode?: 'workout';
      onSaveSet: (input: SaveSessionSetInput<Id>) => Promise<void>;
    })
  | (SessionExerciseSharedProps & {
      mode: 'plan';
      programExerciseId: number;
      createSet: SessionExerciseSetData;
      onPlanSetSaved: () => void;
      onSaveSet?: never;
    });

/** Program templates use stable cloud IDs and recommendations, without a result-entry contract. */
export interface ProgramSessionExerciseProps {
  mode: 'program';
  /** Calendar occurrences retain numeric assignments; reusable templates do not. */
  showPlanMetrics?: boolean;
  data: CloudProgramDayOutline['exercises'][number];
  surface?: 'default' | 'transparent';
  editable?: boolean;
  busy?: boolean;
  focusSetId?: string;
  focusReady?: boolean;
  collapsed?: boolean;
  defaultCollapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  onAddSet?: () => void;
  onDelete?: () => void;
  onInformation?: () => void;
  onOpenSet?: (setId: string) => void;
  onDeleteSet?: (setId: string) => void | Promise<void>;
  /** Occurrence-only discussion targets; program templates never receive them. */
  discussionTarget?: EntityDiscussionTarget | null;
  discussionTargetForSet?: (setId: string) => EntityDiscussionTarget | null;
  onOpenDiscussion?: OpenEntityDiscussion;
  onNavigationContextChange?: (context: NavigationContext | null) => void;
  onSetDeletionNavigationContextChange?: (context: NavigationContext | null) => void;
}

export type SessionExerciseProps<Id extends string | number = number> = WorkoutSessionExerciseProps<Id> | ProgramSessionExerciseProps;
