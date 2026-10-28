import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { AdHocWorkoutRepository } from '../data/cloud/adhoc-workouts';
import { WorkoutOccurrenceDraftRepository } from '../data/cloud/workout-occurrence-drafts';
import type { LocalWorkoutOccurrenceDraft } from '../data/cloud/workout-occurrence-plan';
import { MezfitDialog, MezfitDialogButton } from '../ui';
import { PlannedWorkoutConflict } from '../data/cloud/planned-workout-conflicts';
import { PlannedWorkoutConflictSheet } from './PlannedWorkoutConflictSheet';
import { adHocErrorMessage } from './adhoc-workout-errors';

type CancellationPresentation = (id: string, commit: () => Promise<void>) => Promise<void>;
interface PlannedWorkoutStart {
  conflictActive: boolean;
  dismissConflict: () => void;
  cancel: (id: string) => Promise<void>;
  registerCancellationPresentation: (handler: CancellationPresentation) => () => void;
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
  const [conflict, setConflict] = useState<PlannedWorkoutConflict['occurrences'][number] | null>(null);
  const [conflictOpened, setConflictOpened] = useState(false);
  const [conflictActive, setConflictActive] = useState(false);
  const decision = useRef<'cancel' | 'back'>('back');
  const pendingDecision = useRef<((value: 'cancel' | 'back') => void) | null>(null);
  const presentation = useRef<CancellationPresentation | null>(null);
  const dismissConflict = useCallback(() => { decision.current = 'back'; setConflictOpened(false); }, []);
  const registerCancellationPresentation = useCallback((handler: CancellationPresentation) => {
    presentation.current = handler;
    return () => { if (presentation.current === handler) presentation.current = null; };
  }, []);
  const cancel = useCallback(async (id: string) => {
    if (!drafts) throw new Error('Отмена тренировки недоступна');
    const commit = () => drafts.cancel(id);
    if (presentation.current) await presentation.current(id, commit);
    else await commit();
  }, [drafts]);
  useEffect(() => {
    ++generation.current; running.current = false; setBlocked(false);
    pendingDecision.current?.('back'); pendingDecision.current = null; setConflictOpened(false); setConflict(null); setConflictActive(false);
    return () => { ++generation.current; pendingDecision.current?.('back'); pendingDecision.current = null; };
  }, [repository, role]);
  const start = useCallback(async (draft: LocalWorkoutOccurrenceDraft) => {
    if (!repository || !drafts || role !== 'coach') throw new Error('Запуск тренировки недоступен');
    if (running.current) throw new Error('Тренировка уже запускается');
    const token = generation.current;
    running.current = true;
    try {
      await drafts.flushEdits(draft.id);
      if (token !== generation.current) throw new Error('Запуск тренировки отменён');
      const occurrenceId = draft.targetOccurrenceId ?? draft.id.slice(6);
      const create = async (): Promise<string> => {
        while (token === generation.current) {
          try { return (await repository.createFromOccurrence(occurrenceId)).id; }
          catch (reason) {
            if (!(reason instanceof PlannedWorkoutConflict)) throw reason;
            const row = reason.occurrences[0];
            if (!row) throw reason;
            const choice = await new Promise<'cancel' | 'back'>(resolve => {
              pendingDecision.current = resolve; decision.current = 'back';
              setConflictActive(true); setConflict(row); setConflictOpened(true);
            });
            if (token !== generation.current || choice !== 'cancel') throw new Error('Запуск тренировки отменён');
            await cancel(row.id);
          }
        }
        throw new Error('Запуск тренировки отменён');
      };
      const id = await create();
      if (token !== generation.current) throw new Error('Запуск тренировки отменён');
      return id;
    } catch (reason) {
      if (token === generation.current && reason instanceof Error && reason.message === 'ADHOC_ACTIVE_SESSION_EXISTS')
        setBlocked(true);
      throw new Error(adHocErrorMessage(reason, 'Не удалось начать тренировку'));
    } finally { if (token === generation.current) { running.current = false; setConflictActive(false); } }
  }, [repository, drafts, role, cancel]);
  const showSession = useCallback((id: string) => onStartedRef.current(id), []);
  const value = useMemo(() => role === 'coach' && repository ? { start, showSession, cancel, registerCancellationPresentation, conflictActive, dismissConflict } : null, [repository, role, start, showSession, cancel, registerCancellationPresentation, conflictActive, dismissConflict]);
  return <Context.Provider value={value}>
    {children}
    <PlannedWorkoutConflictSheet occurrence={conflict} opened={conflictOpened}
      onDecision={value => { decision.current = value; setConflictOpened(false); }}
      onClosed={() => {
        const resolve = pendingDecision.current; pendingDecision.current = null;
        setConflict(null); resolve?.(decision.current);
      }} />
    <MezfitDialog opened={blocked} title="Завершите текущую тренировку, чтобы начать новую."
      onBackdropClick={() => setBlocked(false)}
      buttons={<MezfitDialogButton strong onClick={() => setBlocked(false)}>Понятно</MezfitDialogButton>} />
  </Context.Provider>;
}
