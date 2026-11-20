import type { LocalWorkoutOccurrenceDraft } from './workout-occurrence-plan';

/** Once started, an occurrence's accepted PLAN is immutable in every editor. */
export const STARTED_PLAN_MESSAGE = 'Тренировка была запущена. Изменить план нельзя';

/** Editing an accepted occurrence is independent of who authored the source program. */
export function occurrencePlanEditRestriction(draft: Pick<LocalWorkoutOccurrenceDraft,
  'actorUserId' | 'athleteUserId' | 'coachUserId' | 'format' | 'workoutSessionId' | 'executionStatus'>): string | null {
  if (draft.workoutSessionId || (draft.executionStatus && draft.executionStatus !== 'scheduled'))
    return STARTED_PLAN_MESSAGE;
  if (draft.coachUserId === draft.actorUserId) return null;
  if (draft.format === 'independent' && draft.athleteUserId === draft.actorUserId) return null;
  if (draft.format === 'coached' && draft.athleteUserId === draft.actorUserId)
    return 'План тренировки с тренером может изменять только тренер.';
  return 'У вас нет прав изменять план этой тренировки.';
}
