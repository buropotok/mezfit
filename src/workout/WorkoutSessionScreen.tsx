import { useEffect, useRef, useState } from 'react';
import {
  ApiError,
  completeWorkoutSession,
  initializeWorkoutSession,
  reorderWorkoutSessionExercises,
  saveWorkoutSessionSet,
  startWorkoutSession,
} from '../api';
import { Button, List, ListItem, Modal, SortableList, Text, type SortableListItem } from '../ui';
import { SessionExercise } from './SessionExercise';
import type { SaveSessionSetInput } from './sessionExerciseTypes';
import type {
  ActiveWorkoutSession,
  DraftWorkoutSession,
  WorkoutDayOption,
  WorkoutSessionScreenProps,
  WorkoutSessionState,
} from './workoutSessionTypes';
import './workout-session-screen.css';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function sessionMeta(session: ActiveWorkoutSession): string {
  if (!session.program) return 'Своя тренировка';
  return [session.program.name, session.phase?.name, session.day?.name].filter(Boolean).join(' · ');
}

function draftMeta(session: DraftWorkoutSession): string {
  return [session.program?.name, session.phase?.name].filter(Boolean).join(' · ');
}

function reorderExerciseData(session: ActiveWorkoutSession, ids: number[]): ActiveWorkoutSession {
  const byId = new Map(session.exercises.map((exercise) => [exercise.sessionExerciseId, exercise]));
  const exercises = ids
    .map((id, position) => {
      const exercise = byId.get(id);
      return exercise ? { ...exercise, position } : null;
    })
    .filter((exercise): exercise is ActiveWorkoutSession['exercises'][number] => exercise !== null);
  return { ...session, exercises };
}

function exerciseOrder(session: WorkoutSessionState): number[] {
  return session.status === 'draft'
    ? []
    : session.exercises.map((exercise) => exercise.sessionExerciseId);
}

export function WorkoutSessionScreen({
  initData,
  trainingPlanId = null,
  onClose,
  onOpenExerciseMenu,
  onOpenHistory,
  onOpenChat,
  onAddExercise,
  onSessionLifecycleChange,
}: WorkoutSessionScreenProps) {
  const [session, setSession] = useState<WorkoutSessionState | null>(null);
  const [selectedDayId, setSelectedDayId] = useState<number | null>(null);
  const [collapsedByExerciseId, setCollapsedByExerciseId] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dayPickerOpen, setDayPickerOpen] = useState(false);
  const [completeConfirmOpen, setCompleteConfirmOpen] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const lifecycleCallbackRef = useRef(onSessionLifecycleChange);
  const reorderQueueRef = useRef<Promise<void>>(Promise.resolve());
  const reorderVersionRef = useRef(0);
  const acknowledgedExerciseOrderRef = useRef<number[]>([]);

  useEffect(() => {
    lifecycleCallbackRef.current = onSessionLifecycleChange;
  }, [onSessionLifecycleChange]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setInitializationError(null);

    initializeWorkoutSession(initData, trainingPlanId)
      .then(({ session: nextSession }) => {
        if (cancelled) return;
        acknowledgedExerciseOrderRef.current = exerciseOrder(nextSession);
        setSession(nextSession);
        setMessage(null);
        if (nextSession.status === 'draft') {
          setSelectedDayId(nextSession.suggestedDay?.id ?? null);
        }
        lifecycleCallbackRef.current?.({ sessionId: nextSession.sessionId, status: nextSession.status });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setInitializationError(errorMessage(error, 'Не удалось подготовить тренировку'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [initData, retryVersion, trainingPlanId]);

  const activeSession = session?.status === 'active' || session?.status === 'completed' ? session : null;
  const draftSession = session?.status === 'draft' ? session : null;

  async function startDraft(input: { type: 'own' } | { type: 'program'; programDayId: number }) {
    if (!draftSession) return;
    setBusyLabel(input.type === 'own' ? 'Начинаем свою тренировку…' : 'Загружаем свежий план…');
    setMessage(null);
    try {
      const { session: nextSession } = await startWorkoutSession(initData, draftSession.sessionId, input);
      acknowledgedExerciseOrderRef.current = exerciseOrder(nextSession);
      setSession(nextSession);
      setDayPickerOpen(false);
      lifecycleCallbackRef.current?.({ sessionId: nextSession.sessionId, status: nextSession.status });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'PROGRAM_DAY_INVALID') {
        setMessage('План изменился. Обновляем доступные дни…');
        setRetryVersion((version) => version + 1);
      } else {
        setMessage(errorMessage(error, 'Не удалось начать тренировку'));
      }
    } finally {
      setBusyLabel(null);
    }
  }

  async function handleSaveSet(input: SaveSessionSetInput) {
    if (!activeSession || activeSession.status !== 'active') throw new Error('Тренировка не активна');
    const { session: nextSession } = await saveWorkoutSessionSet(
      initData,
      activeSession.sessionId,
      input.sessionSetId,
      input.fact,
    );
    acknowledgedExerciseOrderRef.current = exerciseOrder(nextSession);
    setSession(nextSession);
  }

  function handleReorder(items: SortableListItem[]) {
    if (!activeSession || activeSession.status !== 'active') return;
    const ids = items.map((item) => Number(item.id));
    const version = reorderVersionRef.current + 1;
    reorderVersionRef.current = version;
    setSession(reorderExerciseData(activeSession, ids));
    setMessage(null);

    reorderQueueRef.current = reorderQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          const { session: nextSession } = await reorderWorkoutSessionExercises(initData, activeSession.sessionId, ids);
          acknowledgedExerciseOrderRef.current = exerciseOrder(nextSession);
          if (version === reorderVersionRef.current) setSession(nextSession);
        } catch (error) {
          if (version === reorderVersionRef.current) {
            const acknowledgedIds = acknowledgedExerciseOrderRef.current;
            setSession((currentSession) => {
              if (!currentSession || currentSession.status === 'draft') return currentSession;
              return reorderExerciseData(currentSession, acknowledgedIds);
            });
            setMessage(errorMessage(error, 'Не удалось сохранить порядок упражнений'));
          }
        }
      });
  }

  async function handleComplete() {
    if (!activeSession || activeSession.status !== 'active') return;
    setBusyLabel('Завершаем тренировку…');
    setMessage(null);
    try {
      const { session: nextSession } = await completeWorkoutSession(initData, activeSession.sessionId);
      acknowledgedExerciseOrderRef.current = exerciseOrder(nextSession);
      setSession(nextSession);
      setCompleteConfirmOpen(false);
      lifecycleCallbackRef.current?.({ sessionId: nextSession.sessionId, status: nextSession.status });
      onClose();
    } catch (error) {
      setMessage(errorMessage(error, 'Не удалось завершить тренировку'));
    } finally {
      setBusyLabel(null);
    }
  }

  const sortableItems: SortableListItem[] = activeSession
    ? activeSession.exercises.map((exercise) => ({
        id: exercise.sessionExerciseId,
        content: (
          <SessionExercise
            context={{
              workoutSessionId: activeSession.sessionId,
              workoutDate: activeSession.workoutDate,
              program: activeSession.program,
            }}
            data={exercise}
            collapsed={collapsedByExerciseId[exercise.sessionExerciseId] ?? false}
            onCollapsedChange={(collapsed) => {
              setCollapsedByExerciseId((current) => ({ ...current, [exercise.sessionExerciseId]: collapsed }));
            }}
            onSaveSet={handleSaveSet}
            onOpenExerciseMenu={onOpenExerciseMenu}
            onOpenHistory={onOpenHistory}
            onOpenChat={onOpenChat}
          />
        ),
      }))
    : [];

  if (initializationError) {
    return (
      <section className="workout-session-screen">
        <Text variant="large-title">Тренировка</Text>
        <div className="workout-session-screen__message">
          <Text tone="muted">{initializationError}</Text>
        </div>
        <div className="workout-session-screen__actions">
          <Button onClick={() => setRetryVersion((version) => version + 1)}>Повторить</Button>
          <Button variant="secondary" onClick={onClose}>Закрыть</Button>
        </div>
      </section>
    );
  }

  return (
    <section className="workout-session-screen">
      <div className="workout-session-screen__heading">
        <Text variant="large-title">Тренировка</Text>
        {activeSession ? <Text variant="footnote" tone="muted">{sessionMeta(activeSession)}</Text> : null}
      </div>

      {message ? <Text variant="footnote" tone="muted" className="workout-session-screen__message">{message}</Text> : null}

      {draftSession ? (
        <div className="workout-session-screen__draft">
          {draftSession.program ? (
            <>
              <List>
                <ListItem
                  interactive={false}
                  title={draftSession.availableDays.find((day) => day.id === selectedDayId)?.name ?? 'Выберите день'}
                  subtitle={draftMeta(draftSession)}
                />
              </List>
              <div className="workout-session-screen__actions">
                <Button
                  disabled={selectedDayId === null}
                  onClick={() => {
                    if (selectedDayId !== null) void startDraft({ type: 'program', programDayId: selectedDayId });
                  }}
                >
                  Начать тренировку
                </Button>
                <Button
                  variant="secondary"
                  disabled={draftSession.availableDays.length === 0}
                  onClick={() => setDayPickerOpen(true)}
                >
                  Сменить день
                </Button>
                <Button variant="secondary" onClick={() => void startDraft({ type: 'own' })}>Своя тренировка</Button>
              </div>
            </>
          ) : (
            <>
              <Text tone="muted">Активной программы нет. Можно начать свою тренировку.</Text>
              <div className="workout-session-screen__actions">
                <Button onClick={() => void startDraft({ type: 'own' })}>Своя тренировка</Button>
              </div>
            </>
          )}
        </div>
      ) : null}

      {activeSession?.status === 'active' ? (
        <>
          {sortableItems.length > 0 ? (
            <SortableList items={sortableItems} onReorder={handleReorder} showSeparators={false} />
          ) : (
            <div className="workout-session-screen__empty">
              <Text tone="muted">Упражнений пока нет.</Text>
              {onAddExercise ? <Button variant="secondary" onClick={() => onAddExercise(activeSession.sessionId)}>Добавить упражнение</Button> : null}
            </div>
          )}
          <div className="workout-session-screen__footer">
            {onAddExercise && sortableItems.length > 0 ? (
              <Button variant="secondary" onClick={() => onAddExercise(activeSession.sessionId)}>Добавить упражнение</Button>
            ) : null}
            <Button onClick={() => setCompleteConfirmOpen(true)}>Завершить тренировку</Button>
          </div>
        </>
      ) : null}

      <Modal
        isOpen={loading || busyLabel !== null}
        title={busyLabel ?? 'Подготавливаем тренировку'}
        hasCloseButton={false}
        closeOnBackdrop={false}
        onClose={() => {}}
      >
        <div className="workout-session-screen__loader">
          <span className="workout-session-screen__spinner" aria-hidden="true" />
          <Text tone="muted">{busyLabel ?? 'Получаем актуальные данные…'}</Text>
        </div>
      </Modal>

      <Modal
        isOpen={dayPickerOpen}
        title="Выберите день"
        onClose={() => setDayPickerOpen(false)}
      >
        <List>
          {(draftSession?.availableDays ?? []).map((day: WorkoutDayOption) => (
            <ListItem
              key={day.id}
              title={day.name}
              subtitle={day.completed ? 'Уже выполнялся' : undefined}
              onClick={() => {
                setSelectedDayId(day.id);
                setDayPickerOpen(false);
              }}
            />
          ))}
        </List>
      </Modal>

      <Modal
        isOpen={completeConfirmOpen}
        variant="alert"
        title="Завершить тренировку?"
        closeOnBackdrop={false}
        actions={[
          { id: 'cancel', label: 'Продолжить', onClick: () => setCompleteConfirmOpen(false) },
          { id: 'complete', label: 'Завершить', tone: 'primary', onClick: () => void handleComplete() },
        ]}
        onClose={() => setCompleteConfirmOpen(false)}
      >
        После завершения тренировка сохранится в истории.
      </Modal>
    </section>
  );
}
