import type { NavigationContext } from '../NavigationShell';
import type { SessionExerciseData } from './sessionExerciseTypes';

export interface WorkoutProgramSummary<Id extends string | number = number> {
  id: Id;
  name: string;
}

export interface WorkoutPhaseSummary<Id extends string | number = number> {
  id: Id;
  name: string;
}

export interface WorkoutDaySummary<Id extends string | number = number> {
  id: Id;
  name: string;
  position: number;
}

export interface WorkoutCreatorSummary<Id extends string | number = number> {
  id: Id;
  firstName: string;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
}

export interface WorkoutDayOption extends WorkoutDaySummary {
  completed: boolean;
}

export interface SuggestedWorkoutDay extends WorkoutDaySummary {
  resolution: 'scheduled_today' | 'next_incomplete';
  occurrenceId: number | null;
}

export interface DraftWorkoutSession {
  sessionId: number;
  status: 'draft';
  program: WorkoutProgramSummary | null;
  phase: WorkoutPhaseSummary | null;
  suggestedDay: SuggestedWorkoutDay | null;
  availableDays: WorkoutDayOption[];
}

export interface ActiveWorkoutSession<Id extends string | number = number> {
  sessionId: Id;
  occurrenceId: Id | null;
  status: 'active' | 'completed';
  workoutDate: string;
  startedAt: string | null;
  completedAt: string | null;
  program: WorkoutProgramSummary<Id> | null;
  phase: WorkoutPhaseSummary<Id> | null;
  day: WorkoutDaySummary<Id> | null;
  creator?: WorkoutCreatorSummary<Id>;
  exercises: SessionExerciseData<Id>[];
}

export type WorkoutSessionState = DraftWorkoutSession | ActiveWorkoutSession;

export interface OpenWorkoutSessionSummary {
  sessionId: number;
  status: 'draft' | 'active';
}

export type WorkoutStartInput =
  | { type: 'own' }
  | { type: 'program'; programDayId: number; occurrenceId?: number };

export interface WorkoutSessionScreenProps {
  initData: string;
  trainingPlanId?: number | null;
  onClose: () => void;
  onOpenExerciseMenu?: (sessionExerciseId: number) => void;
  onOpenHistory?: (exerciseDefinitionId: number) => void;
  onOpenChat?: () => void;
  onSessionLifecycleChange?: (session: Pick<WorkoutSessionState, 'sessionId' | 'status'>) => void;
  onNavigationContextChange?: (context: NavigationContext | null) => void;
}
