import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { useClientWorkout } from './ClientWorkoutContext';
import { AdHocWorkoutRepository } from '../data/cloud/adhoc-workouts';
import { WorkoutOccurrenceDraftRepository } from '../data/cloud/workout-occurrence-drafts';
import type { LocalWorkoutOccurrenceDraft } from '../data/cloud/workout-occurrence-plan';
import { MezfitDialog, MezfitDialogButton, Text } from '../ui';
import { PlannedWorkoutConflict } from '../data/cloud/planned-workout-conflicts';
import { PlannedWorkoutConflictSheet } from './PlannedWorkoutConflictSheet';
import { adHocErrorMessage, WorkoutStartDismissed } from './adhoc-workout-errors';

type CancellationPresentation = (id: string, commit: () => Promise<void>) => Promise<void>;
export interface ProgramWorkoutStartInput { athleteUserId: string; programId?: string; dayId?: string }
type StartResult = { id: string; createdProgram: boolean };
interface PlannedWorkoutStart {
  conflictActive: boolean;
  conflictOccurrence: PlannedWorkoutConflict['occurrences'][number] | null;
  dismissConflict: () => void;
  cancel: (id: string) => Promise<void>;
  registerCancellationPresentation: (handler: CancellationPresentation) => () => void;
  start: (draft: LocalWorkoutOccurrenceDraft, isCurrent?: () => boolean) => Promise<string>;
  startQuick: (isCurrent?: () => boolean) => Promise<StartResult>;
  startFromProgram: (input: ProgramWorkoutStartInput, isCurrent?: () => boolean) => Promise<StartResult>;
  showSession: (id: string) => void;
}
const Context = createContext<PlannedWorkoutStart | null>(null);
export const usePlannedWorkoutStart = () => useContext(Context);

/** Shared local Start owner; client execution reads published PLAN without editing it. */
export function PlannedWorkoutStartProvider(props: {
  role: 'coach' | 'client'; enabled?: boolean; onStarted: (id: string) => void; children: ReactNode;
}) {
  return props.enabled !== false ? <LocalWorkoutStartProvider {...props} /> : <>{props.children}</>;
}

function LocalWorkoutStartProvider({ role, onStarted, children }: {
  role: 'coach' | 'client'; onStarted: (id: string) => void; children: ReactNode;
}) {
  const cloud = useCloudConnections();
  const clientWorkout = useClientWorkout();
  const repository = useMemo(() => role === 'client' ? clientWorkout?.repository ?? null
    : cloud ? new AdHocWorkoutRepository(cloud.db, cloud.actorUserId) : null,
    [role, clientWorkout?.repository, cloud?.db, cloud?.actorUserId]);
  const drafts = useMemo(() => cloud ? new WorkoutOccurrenceDraftRepository(cloud.db, cloud.actorUserId) : null,
    [cloud?.db, cloud?.actorUserId]);
  const running = useRef(false);
  const generation = useRef(0);
  const onStartedRef = useRef(onStarted);
  onStartedRef.current = onStarted;
  const [blocked, setBlocked] = useState(false);
  const [coachedPrompt, setCoachedPrompt] = useState(false);
  const coachedDecision = useRef<((accepted: boolean) => void) | null>(null);
  const decideCoached = (accepted: boolean) => {
    const resolve = coachedDecision.current; coachedDecision.current = null;
    setCoachedPrompt(false); resolve?.(accepted);
  };
  const [conflict, setConflict] = useState<PlannedWorkoutConflict['occurrences'][number] | null>(null);
  const [conflictOpened, setConflictOpened] = useState(false);
  const [conflictActive, setConflictActive] = useState(false);
  const [conflictError, setConflictError] = useState('');
  const abandoned = useRef(false);
  const decision = useRef<'cancel' | 'back'>('back');
  const pendingDecision = useRef<((value: 'cancel' | 'back') => void) | null>(null);
  const presentation = useRef<CancellationPresentation | null>(null);
  const dismissConflict = useCallback(() => { abandoned.current = true; decision.current = 'back'; setConflictOpened(false); }, []);
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
    ++generation.current; running.current = false; setBlocked(false); setConflictError('');
    coachedDecision.current?.(false); coachedDecision.current = null; setCoachedPrompt(false);
    pendingDecision.current?.('back'); pendingDecision.current = null; setConflictOpened(false); setConflict(null); setConflictActive(false);
    return () => { ++generation.current; coachedDecision.current?.(false); coachedDecision.current = null; pendingDecision.current?.('back'); pendingDecision.current = null; };
  }, [repository, role]);
  const runStart = useCallback(async <T,>(create: () => Promise<T>, prepare?: () => Promise<void>,
    isCurrent: () => boolean = () => true): Promise<T> => {
    if (!repository) throw new Error('Запуск тренировки недоступен');
    if (running.current) throw new Error('Тренировка уже запускается');
    const token = generation.current;
    const current = () => token === generation.current && !abandoned.current && isCurrent();
    running.current = true; abandoned.current = false; setConflictError('');
    try {
      if (!current()) throw new Error('Запуск тренировки отменён');
      await prepare?.();
      while (current()) {
        try { return await create(); }
        catch (reason) {
          if (!(reason instanceof PlannedWorkoutConflict) || !current()) throw reason;
          const row = reason.occurrences[0];
          if (!row) throw reason;
          const choice = await new Promise<'cancel' | 'back'>(resolve => {
            pendingDecision.current = resolve; decision.current = 'back';
            setConflictActive(true); setConflict(row); setConflictOpened(true);
          });
          if (!current() || choice !== 'cancel') throw new Error('Запуск тренировки отменён');
          try { await cancel(row.id); }
          catch (reason) {
            if (current()) setConflictError(adHocErrorMessage(reason, 'Не удалось отменить тренировку'));
            throw reason;
          }
        }
      }
      throw new Error('Запуск тренировки отменён');
    } finally { if (token === generation.current) { running.current = false; setConflictActive(false); setConflict(null); } }
  }, [repository, role, cancel]);
  const start = useCallback(async (draft: LocalWorkoutOccurrenceDraft, isCurrent: () => boolean = () => true) => {
    if (!repository || !drafts) throw new Error('Запуск тренировки недоступен');
    const occurrenceId = draft.targetOccurrenceId ?? draft.id.slice(6);
    const token = generation.current;
    try {
      let asCoached = false;
      return await runStart(async () => {
        try {
          return (await (asCoached ? repository.createFromOccurrence(occurrenceId, { asCoached: true })
            : repository.createFromOccurrence(occurrenceId))).id;
        } catch (reason) {
          if (role !== 'coach' || asCoached || !(reason instanceof Error)
            || reason.message !== 'PLANNED_INDEPENDENT_REQUIRES_COACHING') throw reason;
          if (token !== generation.current || !isCurrent()) throw new WorkoutStartDismissed();
          const accepted = await new Promise<boolean>(resolve => {
            coachedDecision.current = resolve; setCoachedPrompt(true);
          });
          if (!accepted || token !== generation.current || !isCurrent()) throw new WorkoutStartDismissed();
          asCoached = true;
          return (await repository.createFromOccurrence(occurrenceId, { asCoached: true })).id;
        }
      }, role === 'coach' ? () => drafts.flushEdits(draft.id) : undefined, isCurrent);
    } catch (reason) {
      if (reason instanceof WorkoutStartDismissed) throw reason;
      if (token === generation.current && reason instanceof Error && reason.message === 'ADHOC_ACTIVE_SESSION_EXISTS') setBlocked(true);
      throw new Error(adHocErrorMessage(reason, 'Не удалось начать тренировку'));
    }
  }, [repository, drafts, runStart, role]);
  const startQuick = useCallback((isCurrent?: () => boolean) => {
    if (!repository) return Promise.reject(new Error('Запуск тренировки недоступен'));
    return runStart(() => repository.createQuick(), undefined, isCurrent);
  }, [repository, runStart]);
  const startFromProgram = useCallback((input: ProgramWorkoutStartInput, isCurrent?: () => boolean) => {
    if (!repository) return Promise.reject(new Error('Запуск тренировки недоступен'));
    return runStart(() => repository.createForAthlete(input.athleteUserId, input.programId, input.dayId), undefined, isCurrent);
  }, [repository, runStart]);
  const showSession = useCallback((id: string) => onStartedRef.current(id), []);
  const value = useMemo(() => repository ? { start, startQuick, startFromProgram, showSession, cancel, registerCancellationPresentation, conflictActive, conflictOccurrence: conflict, dismissConflict } : null, [repository, role, start, startQuick, startFromProgram, showSession, cancel, registerCancellationPresentation, conflictActive, conflict, dismissConflict]);
  return <Context.Provider value={value}>
    {children}
    {coachedPrompt ? <MezfitDialog opened role="alertdialog" aria-label="Начать тренировку в зале с клиентом?"
      title={<Text variant="headline">Вы не можете начать самостоятельную тренировку спортсмена. Начать эту тренировку в зале с клиентом?</Text>}
      onBackdropClick={() => decideCoached(false)}
      buttons={<>
        <MezfitDialogButton onClick={() => decideCoached(false)}><Text variant="body">Нет</Text></MezfitDialogButton>
        <MezfitDialogButton strong onClick={() => decideCoached(true)}><Text variant="body">Да</Text></MezfitDialogButton>
      </>} /> : null}
    <PlannedWorkoutConflictSheet occurrence={conflict} opened={conflictOpened}
      onDecision={value => { if (value === 'back') abandoned.current = true; decision.current = value; setConflictOpened(false); }}
      onClosed={() => {
        const resolve = pendingDecision.current; pendingDecision.current = null;
        resolve?.(decision.current);
      }} />
    <MezfitDialog opened={Boolean(conflictError)} title={<Text variant="headline">Не удалось отменить тренировку</Text>}
      onBackdropClick={() => setConflictError('')}
      buttons={<MezfitDialogButton strong onClick={() => setConflictError('')}>Понятно</MezfitDialogButton>}>
      <Text variant="body">{conflictError}</Text>
    </MezfitDialog>
    <MezfitDialog opened={blocked} title="Завершите текущую тренировку, чтобы начать новую."
      onBackdropClick={() => setBlocked(false)}
      buttons={<MezfitDialogButton strong onClick={() => setBlocked(false)}>Понятно</MezfitDialogButton>} />
  </Context.Provider>;
}
