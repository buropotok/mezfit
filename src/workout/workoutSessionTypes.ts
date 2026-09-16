import type { SessionExerciseData } from './sessionExerciseTypes';

export interface WorkoutProgramSummary {
  id: number;
  name: string;
}

export interface WorkoutPhaseSummary {
  id: number;
  name: string;
}

export interface WorkoutDaySummary {
  id: number;
  name: string;
  position: number;
}

export interface WorkoutDayOption extends WorkoutDaySummary {
  completed: boolean;
}

export interface SuggestedWorkoutDay extends WorkoutDaySummary {
  resolution: 'scheduled_today' | 'next_incomplete';
}

export interface DraftWorkoutSession {
  sessionId: number;
  status: 'draft';
  program: WorkoutProgramSummary | null;
  phase: WorkoutPhaseSummary | null;
  suggestedDay: SuggestedWorkoutDay | null;
  availableDays: WorkoutDayOption[];
}

export interface ActiveWorkoutSession {
  sessionId: number;
  status: 'active' | 'completed';
  workoutDate: string;
  program: WorkoutProgramSummary | null;
  phase: WorkoutPhaseSummary | null;
  day: WorkoutDaySummary | null;
  exercises: SessionExerciseData[];
}

export type WorkoutSessionState = DraftWorkoutSession | ActiveWorkoutSession;

export type WorkoutStartInput =
  | { type: 'own' }
  | { type: 'program'; programDayId: number };

export interface WorkoutSessionScreenProps {
  initData: string;
  trainingPlanId?: number | null;
  onClose: () => void;
  onOpenExerciseMenu?: (sessionExerciseId: number) => void;
  onOpenHistory?: (exerciseDefinitionId: number) => void;
  onOpenChat?: () => void;
  onAddExercise?: (workoutSessionId: number) => void;
  onSessionLifecycleChange?: (session: Pick<WorkoutSessionState, 'sessionId' | 'status'>) => void;
}
