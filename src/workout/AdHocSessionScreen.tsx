import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from 'konsta/react';
import type { NavigationContext } from '../NavigationShell';
import type { AdHocWorkoutRepository } from '../data/cloud/adhoc-workouts';
import type { AdHocSessionRow } from '../data/cloud/adhoc-workout-types';
import type { ProgramActor } from '../program/ProgramSummary';
import { GlassSurface, MezfitDialog, MezfitDialogButton, Text } from '../ui';
import { WorkoutSessionCard } from './WorkoutSessionCard';

import type { ProgramExerciseInformation } from '../data/cloud/program-management';
import { WorkoutExerciseSelectionSheet } from './WorkoutExerciseSelectionSheet';
import type { ActiveWorkoutSession } from './workoutSessionTypes';
import type { PreviousSet } from './setEntryTypes';
import { useWorkoutPerson } from '../schedule/WorkoutPerson';
import { adHocErrorMessage } from './adhoc-workout-errors';
import './workout-session-screen.css';

const ProgramExerciseInformationSheet = lazy(() => import('../program/ProgramExerciseInformationSheet')
  .then(module => ({ default: module.ProgramExerciseInformationSheet })));

/** History is supplied later; missing entries intentionally remain empty. */
export type AdHocPreviousSets = Readonly<Record<string, readonly (PreviousSet | null)[]>>;

/** Public session capabilities consumed by the screen, independent of storage internals. */
export type AdHocSessionRepository = Pick<AdHocWorkoutRepository,
  'actorUserId' | 'observe' | 'reorder' | 'saveSet' | 'addSet' | 'deleteSet' |
  'rename' | 'comment' | 'addExercises' | 'complete' | 'resolveTemplate' | 'deleteExercise'>;

export function AdHocSessionScreen({ repository, sessionId, initData, actor, previousSets,
  onNavigationContextChange, onExerciseInformation, readOnly: requestedReadOnly = false, hideActiveStatus = false, personalCatalogueRole = 'coach' }: {
  repository: AdHocSessionRepository;
  readOnly?: boolean;
  personalCatalogueRole?: 'coach' | 'client';
  hideActiveStatus?: boolean;
  sessionId: string;
  initData: string;
  actor?: ProgramActor;
  previousSets?: AdHocPreviousSets;
  onNavigationContextChange: (value: NavigationContext | null) => void;
  onExerciseInformation?: (exerciseId: string) => Promise<ProgramExerciseInformation>;
}) {
  const [session, setSession] = useState<ActiveWorkoutSession<string> | null>(null);
  const [row, setRow] = useState<AdHocSessionRow | null>(null);
  const readOnly = requestedReadOnly || (personalCatalogueRole === 'client' && row?.athleteUserId !== repository.actorUserId);
  const athlete = useWorkoutPerson(row?.athleteUserId ?? null, row?.realmId ?? '', actor);
  const coach = useWorkoutPerson(row?.coachUserId ?? null, row?.realmId ?? '', actor);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState(false);
  const [finishConfirm, setFinishConfirm] = useState(false);
  const [deleteExerciseId, setDeleteExerciseId] = useState<string | null>(null);
  const [informationExerciseId, setInformationExerciseId] = useState<string | null>(null);
  const [nestedNavigation, setNestedNavigation] = useState<NavigationContext | null>(null);
  const alive = useRef(true);
  const pending = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const availableSession = useRef<ActiveWorkoutSession<string> | null>(null);
  const clearEditingSurfaces = useCallback(() => {
    setSelection(false); setFinishConfirm(false); setDeleteExerciseId(null); setInformationExerciseId(null);
    setNestedNavigation(null);
  }, []);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    availableSession.current = null;
    setLoading(true); setError('');
    const subscription = repository.observe(sessionId, (value, metadata, issue) => {
      if (!active) return;
      availableSession.current = value;
      setSession(value); setRow(metadata ?? null); setLoading(false);
      if (!value || value.status !== 'active') clearEditingSurfaces();
      if (!value) setError(issue ? adHocErrorMessage(new Error(issue)) : 'Тренировка недоступна');
    }, reason => {
      if (!active) return;
      availableSession.current = null;
      clearEditingSurfaces();
      setSession(null); setRow(null);
      setLoading(false); setError(adHocErrorMessage(reason, 'Не удалось прочитать тренировку'));
    });
    return () => { active = false; availableSession.current = null; subscription.unsubscribe(); };
  }, [repository, sessionId, retry, clearEditingSurfaces]);
  // Serialize local intents, including completion after a set Save. Read models
  // come only from the repository observer, never from an older mutation result.
  const mutate = useCallback((operation: () => Promise<void>) => {
    if (readOnly) return Promise.reject(new Error('Редактирование доступно только тренеру'));
    if (availableSession.current?.sessionId !== sessionId)
      return Promise.reject(new Error('Тренировка недоступна. Повторите чтение данных.'));
    ++pending.current;
    setBusy(true); setError('');
    const task = queue.current.catch(() => undefined).then(operation).catch((reason: unknown) => {
      throw new Error(adHocErrorMessage(reason));
    });
    queue.current = task.then(() => undefined, () => undefined);
    return task.finally(() => {
      --pending.current;
      if (alive.current) setBusy(pending.current > 0);
    });
  }, [sessionId, readOnly]);
  const report = useCallback((reason: unknown) => {
    if (alive.current) setError(adHocErrorMessage(reason));
  }, []);
  const closeOverlay = useCallback(() => {
    if (pending.current) return;
    clearEditingSurfaces();
  }, [clearEditingSurfaces]);
  useEffect(() => {
    onNavigationContextChange(nestedNavigation ?? (selection || finishConfirm || deleteExerciseId || informationExerciseId
      ? { level: 2, title: selection ? 'Упражнения' : 'Тренировка', onBack: closeOverlay } : null));
    return () => onNavigationContextChange(null);
  }, [nestedNavigation, selection, finishConfirm, deleteExerciseId, informationExerciseId, closeOverlay, onNavigationContextChange]);
  const loadExerciseInformation = useCallback(() => {
    if (!informationExerciseId || !onExerciseInformation)
      return Promise.reject(new Error('Упражнение недоступно'));
    return onExerciseInformation(informationExerciseId);
  }, [informationExerciseId, onExerciseInformation]);
  const displaySession = useMemo(() => session ? {
    ...session,
    ...(actor ? { creator: { id: repository.actorUserId, firstName: actor.name, lastName: null,
      username: null, photoUrl: actor.photoUrl ?? null } } : {}),
    exercises: session.exercises.map(exercise => ({ ...exercise,
      showPreviousPlaceholder: Boolean(session.program),
      sets: exercise.sets.map((set, index) => ({ ...set,
        previous: previousSets?.[exercise.exercise.id]?.[index] ?? null,
      })),
    })),
  } : null, [session, previousSets, actor, repository.actorUserId]);
  return <section className="adhoc-workouts">
    {loading ? <Text variant="body">Загружаем тренировку…</Text> : null}
    {displaySession ? <>
      <Text variant="body">Атлет: {athlete.name}</Text>
      <div className="workout-participants"><Text variant="body">{session?.format === 'coached' || (!session?.format && row?.coachUserId) ? 'С тренером в зале' : 'Самостоятельная'}</Text>
        {(session?.format === 'coached' || (!session?.format && row?.coachUserId)) ? coach.compactAvatar : null}</div>
      <WorkoutSessionCard showStatus={!hideActiveStatus || displaySession.status !== 'active'} readOnly={readOnly} athleteName={athlete.name} athleteAvatar={athlete.avatar} session={displaySession} title={row?.name} comment={row?.comment}
        onReorderExerciseIds={ids => { void mutate(() => repository.reorder(sessionId, ids)).catch(report); }}
        onSaveSet={input => mutate(() => repository.saveSet(sessionId, input.sessionSetId, input.fact))}
        onAddExercise={() => { if (!pending.current) { setError(''); setSelection(true); } }}
        onAddSet={id => { if (!pending.current) void mutate(() => repository.addSet(sessionId, id)).catch(report); }}
        onDeleteSet={id => mutate(() => repository.deleteSet(sessionId, id))}
        onDeleteExercise={id => { if (!pending.current) setDeleteExerciseId(id); }}
        onExerciseInformation={onExerciseInformation ? id => {
          if (!pending.current) setInformationExerciseId(id);
        } : undefined}
        onRename={!readOnly ? name => mutate(() => repository.rename(sessionId, name)) : undefined}
        onCommentChange={!readOnly && session?.status === 'active' ? comment => mutate(() => repository.comment(sessionId, comment)) : undefined}
        onNavigationContextChange={setNestedNavigation} />
      {!readOnly && session?.status === 'active' ? <GlassSurface component="button" wrapContent={false} shape="capsule"
        preset="modalTuned" className="workout-session-screen__lifecycle-button" aria-disabled={busy}
        onClick={() => { if (!pending.current) setFinishConfirm(true); }}>
        <Text variant="body">Завершить тренировку</Text>
      </GlassSurface> : null}
    </> : null}
    {error ? <><Text variant="footnote" role="alert">{error}</Text>
      {!session ? <Button rounded tonal onClick={() => setRetry(value => value + 1)}>Повторить</Button> : null}</> : null}
    <WorkoutExerciseSelectionSheet opened={selection} initData={initData} personalCatalogueRole={personalCatalogueRole}
      saving={busy} actionError={error} onNavigationContextChange={setNestedNavigation}
      onClose={closeOverlay} onConfirm={ids => {
        if (!ids.length || pending.current) return;
        void mutate(async () => {
          await repository.addExercises(sessionId, ids);
          if (alive.current) { setSelection(false); setNestedNavigation(null); }
        }).catch(report);
      }} />
    {informationExerciseId && onExerciseInformation ? (
      <Suspense fallback={<Text variant="body">Загружаем карточку упражнения…</Text>}>
        <ProgramExerciseInformationSheet key={informationExerciseId}
          exerciseId={informationExerciseId} load={loadExerciseInformation}
          onClose={() => setInformationExerciseId(null)}
          onNavigationContextChange={setNestedNavigation} />
      </Suspense>
    ) : null}
    <MezfitDialog opened={finishConfirm} title="Завершить тренировку?"
      buttons={<>
        <MezfitDialogButton disabled={busy} onClick={closeOverlay}>Отмена</MezfitDialogButton>
        <MezfitDialogButton strong disabled={busy} onClick={() => {
          if (pending.current) return;
          void mutate(async () => {
            await repository.complete(sessionId);
            if (alive.current) { setFinishConfirm(false); setNestedNavigation(null); }
          }).catch(report);
        }}>Завершить</MezfitDialogButton>
      </>}>
      <Text variant="body">Тренировка сохранится в истории.</Text>
      {error ? <Text variant="footnote" role="alert">{error}</Text> : null}
    </MezfitDialog>
    <MezfitDialog opened={!readOnly && personalCatalogueRole === 'coach' && row?.creatorUserId === repository.actorUserId && row?.status === 'completed' && row.templateSaveDecision === 'pending'}
      title="Сохранить шаблон тренировки в программе?" buttons={<>
        <MezfitDialogButton disabled={busy} onClick={() => {
          if (!pending.current) void mutate(() => repository.resolveTemplate(sessionId, false)).catch(report);
        }}>Нет</MezfitDialogButton>
        <MezfitDialogButton strong disabled={busy} onClick={() => {
          if (!pending.current) void mutate(() => repository.resolveTemplate(sessionId, true)).catch(report);
        }}>Да</MezfitDialogButton>
      </>}>
      {error ? <Text variant="footnote" role="alert">{error}</Text> : null}
    </MezfitDialog>
    <MezfitDialog opened={deleteExerciseId !== null}
      title={session?.occurrenceId ? 'Тренировка была запущена. Удаление из плана невозможно.' : 'Удалить упражнение?'}
      onBackdropClick={closeOverlay}
      buttons={session?.occurrenceId
        ? <MezfitDialogButton strong onClick={closeOverlay}>Понятно</MezfitDialogButton> : <>
      <MezfitDialogButton disabled={busy} onClick={closeOverlay}>Отмена</MezfitDialogButton>
      <MezfitDialogButton strong tone="danger" disabled={busy} onClick={() => {
        if (!deleteExerciseId || pending.current) return;
        const id = deleteExerciseId;
        void mutate(async () => {
          await repository.deleteExercise(sessionId, id);
          if (alive.current) setDeleteExerciseId(null);
        }).catch(report);
      }}>Удалить</MezfitDialogButton>
    </>}>{!session?.occurrenceId ? <>
      <Text variant="body">Упражнение и его подходы будут удалены из этой тренировки.</Text>
      {error ? <Text variant="footnote" role="alert">{error}</Text> : null}
    </> : null}</MezfitDialog>
  </section>;
}
