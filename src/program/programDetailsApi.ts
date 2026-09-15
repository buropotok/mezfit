import { ApiError, type ExerciseDefinition, type ProgramListItem, type ProgramOwner } from '../api';

export type ProgramPhaseStatus = 'pending' | 'active' | 'finished';

export interface ProgramPhaseExerciseDetails {
  programExerciseId: number;
  dayId: number;
  dayName: string;
  dayPosition: number;
  position: number;
  setCount: number;
  completed: boolean;
  notes: string | null;
  exercise: ExerciseDefinition;
}

export interface ProgramPhaseDetails {
  id: number;
  name: string;
  position: number;
  status: ProgramPhaseStatus;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  completedExerciseCount: number;
  exerciseCount: number;
  progressPercent: number;
  exercises: ProgramPhaseExerciseDetails[];
}

export interface CoachProgramDetails {
  program: ProgramListItem;
  owner: ProgramOwner;
  ownerType: 'self' | 'client';
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  completedExerciseCount: number;
  exerciseCount: number;
  progressPercent: number;
  phases: ProgramPhaseDetails[];
}

interface ApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
  };
}

const errorMessages: Record<string, string> = {
  PROGRAM_NOT_FOUND: 'Программа не найдена',
  CLIENT_NOT_FOUND: 'Клиент не найден или больше не связан с тренером',
  ROLE_REQUIRED: 'Для этого действия требуется режим тренера',
  UNAUTHORIZED: 'Не удалось подтвердить Telegram-сессию',
};

export async function getCoachProgramDetails(initData: string, programId: number): Promise<CoachProgramDetails> {
  const response = await fetch(`/api/coach/programs/${programId}`, {
    headers: { 'x-telegram-init-data': initData },
  });

  if (!response.ok) {
    let payload: ApiErrorPayload = {};
    try {
      payload = (await response.json()) as ApiErrorPayload;
    } catch {
      // Fall through to the stable client-side error below.
    }
    const code = payload.error?.code;
    throw new ApiError(
      response.status,
      (code && errorMessages[code]) ?? 'Не удалось загрузить программу',
      code,
    );
  }

  const payload = await response.json<{ details: CoachProgramDetails }>();
  return payload.details;
}
