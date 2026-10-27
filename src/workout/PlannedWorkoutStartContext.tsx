import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { AdHocWorkoutRepository } from '../data/cloud/adhoc-workouts';
import { WorkoutOccurrenceDraftRepository } from '../data/cloud/workout-occurrence-drafts';
import type { LocalWorkoutOccurrenceDraft } from '../data/cloud/workout-occurrence-plan';
import { MezfitDialog, MezfitDialogButton } from '../ui';
import { adHocErrorMessage } from './adhoc-workout-errors';

interface PlannedWorkoutStart {
  start: (draft: LocalWorkoutOccurrenceDraft) => Promise<string>;
  showSession: (id: string) => void;
}
const Context = createContext<PlannedWorkoutStart | null>(null);
export const usePlannedWorkoutStart = () => useContext(Context);

/** Shared Start intent for the calendar and Training tab; owns navigation only after acceptance. */
export function PlannedWorkoutStartProvider(props: {
  role: 'coach' | 'client'; enabled?: boolean; onStarted: (id: string) => void; children: ReactNode;
}) {
  return props.role === 'coach' && props.enabled !== false ? <CoachPlannedWorkoutStartProvider {...props} /> : <>{props.children}</>;
}

function CoachPlannedWorkoutStartProvider({ role, onStarted, children }: {
  role: 'coach' | 'client'; onStarted: (id: string) => void; children: ReactNode;
}) {
  const cloud = useCloudConnections();
  const repository = useMemo(() => cloud ? new AdHocWorkoutRepository(cloud.db, cloud.actorUserId) : null,
    [cloud?.db, cloud?.actorUserId]);
  const drafts = useMemo(() => cloud ? new WorkoutOccurrenceDraftRepository(cloud.db, cloud.actorUserId) : null,
    [cloud?.db, cloud?.actorUserId]);
  const running = useRef(false);
  const generation = useRef(0);
  const onStartedRef = useRef(onStarted);
  onStartedRef.current = onStarted;
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    ++generation.current; running.current = false; setBlocked(false);
    return () => { ++generation.current; };
  }, [repository, role]);
  const start = useCallback(async (draft: LocalWorkoutOccurrenceDraft) => {
    if (!repository || !drafts || role !== 'coach') throw new Error('Запуск тренировки недоступен');
    if (running.current) throw new Error('Тренировка уже запускается');
    const token = generation.current;
    running.current = true;
    try {
      await drafts.flushEdits(draft.id);
      if (token !== generation.current) throw new Error('Запуск тренировки отменён');
      const result = await repository.createFromOccurrence(draft.targetOccurrenceId ?? draft.id.slice(6));
      if (token !== generation.current) throw new Error('Запуск тренировки отменён');
      return result.id;
    } catch (reason) {
      if (token === generation.current && reason instanceof Error && reason.message === 'ADHOC_ACTIVE_SESSION_EXISTS')
        setBlocked(true);
      throw new Error(adHocErrorMessage(reason, 'Не удалось начать тренировку'));
    } finally { if (token === generation.current) running.current = false; }
  }, [repository, drafts, role]);
  const showSession = useCallback((id: string) => onStartedRef.current(id), []);
  const value = useMemo(() => role === 'coach' && repository ? { start, showSession } : null, [repository, role, start, showSession]);
  return <Context.Provider value={value}>
    {children}
    <MezfitDialog opened={blocked} title="Завершите текущую тренировку, чтобы начать новую."
      onBackdropClick={() => setBlocked(false)}
      buttons={<MezfitDialogButton strong onClick={() => setBlocked(false)}>Понятно</MezfitDialogButton>} />
  </Context.Provider>;
}
