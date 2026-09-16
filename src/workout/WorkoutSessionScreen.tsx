import { useEffect, useRef, useState } from 'react';
import {
  ApiError,
  addWorkoutSessionExercise,
  completeWorkoutSession,
  initializeWorkoutSession,
  reorderWorkoutSessionExercises,
  saveWorkoutSessionSet,
  startWorkoutSession,
} from '../api';
import { Button, FloatingActionButton, List, ListItem, Modal, SortableList, Text, type SortableListItem } from '../ui';
import { SessionExercise } from './SessionExercise';
import type { SaveSessionSetInput } from './sessionExerciseTypes';
import { WorkoutExercisePicker } from './WorkoutExercisePicker';
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

function AddIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" fill="currentColor" />
    </svg>
  );
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

export function WorkoutSessionScreen({
  initData,
  trainingPlanId = null,
  onClose,
  onOpenExerciseMenu,
  onOpenHistory,
  onOpenChat,
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
  const [exercisePickerOpen, setExercisePickerOpen] = useState(false);
  const [addingExerciseId, setAddingExerciseId] = useState<number | null>(null);
  const [exercisePickerError, setExercisePickerError] = useState('');
  const [completeConfirmOpen, setCompleteConfirmOpen] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const lifecycleCallbackRef = useRef(onSessionLifecycleChange);
  const mountedRef = useRef(true);
  const sessionGenerationRef = useRef(0);
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mutationIntentVersionRef = useRef(0);
  const acknowledgedSessionRef = useRef<WorkoutSessionState | null>(null);

  useEffect(() => {
    lifecycleCallbackRef.current = onSessionLifecycleChange;
  }, [onSessionLifecycleChange]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sessionGenerationRef.current += 1;
      mutationIntentVersionRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const generation = sessionGenerationRef.current + 1;
    sessionGenerationRef.current = generation;
    mutationIntentVersionRef.current += 1;
    let cancelled = false;
    setLoading(true);
    setInitializationError(null);

    initializeWorkoutSession(initData, trainingPlanId)
      .then(({ session: nextSession }) => {
        if (cancelled || !mountedRef.current || generation !== sessionGenerationRef.current) return;
        acknowledgedSessionRef.current = nextSession;
        setSession(nextSession);
        setMessage(null);
        if (nextSession.status === 'draft') {
          setSelectedDayId(nextSession.suggestedDay?.id ?? null);
        }
        lifecycleCallbackRef.current?.({ sessionId: nextSession.sessionId, status: nextSession.status });
      })
      .catch((error: unknown) => {
        if (cancelled || !mountedRef.current || generation !== sessionGenerationRef.current) return;
        setInitializationError(errorMessage(error, 'Не удалось подготовить тренировку'));
      })
      .finally(() => {
        if (!cancelled && mountedRef.current && generation === sessionGenerationRef.current) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [initData, retryVersion, trainingPlanId]);

  const activeSession = session?.status === 'active' || session?.status === 'completed' ? session : null;
  const draftSession = session?.status === 'draft' ? session : null;

  function nextMutationIntent() {
    mutationIntentVersionRef.current += 1;
    return {
      generation: sessionGenerationRef.current,
      version: mutationIntentVersionRef.current,
    };
  }

  function isCurrentGeneration(intent: { generation: number }) {
    return mountedRef.current && intent.generation === sessionGenerationRef.current;
  }

  function isCurrentIntent(intent: { generation: number; version: number }) {
    return isCurrentGeneration(intent) && intent.version === mutationIntentVersionRef.current;
  }

  function enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const queued = mutationQueueRef.current
      .catch(() => undefined)
      .then(operation);
    mutationQueueRef.current = queued.then(() => undefined, () => undefined);
    return queued;
  }

  async function startDraft(input: { type: 'own' } | { type: 'program'; programDayId: number }) {
    if (!draftSession) return;
    const sessionId = draftSession.sessionId;
    const intent = nextMutationIntent();
    setBusyLabel(input.type === 'own' ? 'Начинаем свою тренировку…' : 'Загружаем свежий план…');
    setMessage(null);
    try {
      const { session: nextSession } = await enqueueMutation(() => startWorkoutSession(initData, sessionId, input));
      if (!isCurrentGeneration(intent)) return;
      acknowledgedSessionRef.current = nextSession;
      if (!isCurrentIntent(intent)) return;
      setSession(nextSession);
      setDayPickerOpen(false);
      lifecycleCallbackRef.current?.({ sessionId: nextSession.sessionId, status: nextSession.status });
    } catch (error) {
      if (!isCurrentIntent(intent)) return;
      if (error instanceof ApiError && error.code === 'PROGRAM_DAY_INVALID') {
        setMessage('План изменился. Обновляем доступные дни…');
        setRetryVersion((version) => version + 1);
      } else {
        setMessage(errorMessage(error, 'Не удалось начать тренировку'));
      }
    } finally {
      if (isCurrentGeneration(intent)) setBusyLabel(null);
    }
  }

  async function handleSaveSet(input: SaveSessionSetInput) {
    if (!activeSession || activeSession.status !== 'active') throw new Error('Тренировка не активна');
    const sessionId = activeSession.sessionId;
    const intent = nextMutationIntent();
    const { session: nextSession } = await enqueueMutation(() => saveWorkoutSessionSet(
      initData,
      sessionId,
      input.sessionSetId,
      input.fact,
    ));
    if (!isCurrentGeneration(intent)) return;
    acknowledgedSessionRef.current = nextSession;
    if (isCurrentIntent(intent)) setSession(nextSession);
  }

  function handleReorder(items: SortableListItem[]) {
    if (!activeSession || activeSession.status !== 'active') return;
    const sessionId = activeSession.sessionId;
    const ids = items.map((item) => Number(item.id));
    const intent = nextMutationIntent();
    setSession((currentSession) => {
      if (!currentSession || currentSession.status !== 'active' || currentSession.sessionId !== sessionId) return currentSession;
      return reorderExerciseData(currentSession, ids);
    });
    setMessage(null);

    void enqueueMutation(() => reorderWorkoutSessionExercises(initData, sessionId, ids))
      .then(({ session: nextSession }) => {
        if (!isCurrentGeneration(intent)) return;
        acknowledgedSessionRef.current = nextSession;
        if (isCurrentIntent(intent)) setSession(nextSession);
      })
      .catch((error: unknown) => {
        if (!isCurrentIntent(intent)) return;
        setSession(acknowledgedSessionRef.current);
        setMessage(errorMessage(error, 'Не удалось сохранить порядок упражнений'));
      });
  }

  function openExercisePicker() {
    if (!activeSession || activeSession.status !== 'active') return;
    setExercisePickerError('');
    setExercisePickerOpen(true);
  }

  async function handleAddExercise(exerciseDefinitionId: number) {
    if (!activeSession || activeSession.status !== 'active') return;
    const sessionId = activeSession.sessionId;
    const intent = nextMutationIntent();
    setAddingExerciseId(exerciseDefinitionId);
    setExercisePickerError('');
    try {
      const { session: nextSession } = await enqueueMutation(() => addWorkoutSessionExercise(
        initData,
        sessionId,
        exerciseDefinitionId,
      ));
      if (!isCurrentGeneration(intent)) return;
      acknowledgedSessionRef.current = nextSession;
      if (!isCurrentIntent(intent)) return;
      setSession(nextSession);
      setExercisePickerOpen(false);
    } catch (error) {
      if (isCurrentIntent(intent)) setExercisePickerError(errorMessage(error, 'Не удалось добавить упражнение'));
    } finally {
      if (isCurrentGeneration(intent)) setAddingExerciseId(null);
    }
  }

  async function handleComplete() {
    if (!activeSession || activeSession.status !== 'active') return;
    const sessionId = activeSession.sessionId;
    const intent = nextMutationIntent();
    setBusyLabel('Завершаем тренировку…');
    setMessage(null);
    try {
      const { session: nextSession } = await enqueueMutation(() => completeWorkoutSession(initData, sessionId));
      if (!isCurrentGeneration(intent)) return;
      acknowledgedSessionRef.current = nextSession;
      if (!isCurrentIntent(intent)) return;
      setSession(nextSession);
      setExercisePickerOpen(false);
      setCompleteConfirmOpen(false);
      lifecycleCallbackRef.current?.({ sessionId: nextSession.sessionId, status: nextSession.status });
      onClose();
    } catch (error) {
      if (isCurrentIntent(intent)) setMessage(errorMessage(error, 'Не удалось завершить тренировку'));
    } finally {
      if (isCurrentGeneration(intent)) setBusyLabel(null);
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
            </div>
          )}
          <div className="workout-session-screen__footer">
            <Button onClick={() => setCompleteConfirmOpen(true)}>Завершить тренировку</Button>
          </div>
          <FloatingActionButton
            placement="right"
            label="Добавить упражнение"
            onClick={openExercisePicker}
          >
            <AddIcon />
          </FloatingActionButton>
        </>
      ) : null}

      <WorkoutExercisePicker
        initData={initData}
        isOpen={exercisePickerOpen}
        addingExerciseId={addingExerciseId}
        actionError={exercisePickerError}
        onAdd={(exerciseDefinitionId) => void handleAddExercise(exerciseDefinitionId)}
        onClose={() => {
          if (addingExerciseId !== null) return;
          setExercisePickerOpen(false);
          setExercisePickerError('');
        }}
      />

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
