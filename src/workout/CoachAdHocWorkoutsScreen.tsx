import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, List, ListItem, Toast } from 'konsta/react';
import { useNavigationFloatingAction, type NavigationContext, type NavigationFloatingAction } from '../NavigationShell';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { AdHocWorkoutRepository, type AdHocOpenSession } from '../data/cloud/adhoc-workouts';
import type { ProgramActor } from '../program/ProgramSummary';
import { ScheduleWorkoutCreator } from '../schedule/ScheduleWorkoutCreator';
import { MezfitBottomSheet, MezfitDialog, MezfitDialogButton, Text } from '../ui';
import { AdHocSessionScreen } from './AdHocSessionScreen';
import { adHocErrorMessage } from './adhoc-workout-errors';
import './adhoc-workouts.css';

type StartInput = { athleteUserId: string; programId?: string; dayId?: string };
const alreadyActive = (reason: unknown) => reason instanceof Error && reason.message === 'ADHOC_ACTIVE_SESSION_EXISTS';
const ignoreScheduledCreation = () => {};

export function CoachAdHocWorkoutsScreen({ initData, actor, onNavigationContextChange }: {
  initData: string;
  actor?: ProgramActor;
  onNavigationContextChange: (value: NavigationContext | null) => void;
}) {
  const cloud = useCloudConnections();
  const repository = useMemo(() => cloud ? new AdHocWorkoutRepository(cloud.db, cloud.actorUserId) : null,
    [cloud?.db, cloud?.actorUserId]);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [plannedOpen, setPlannedOpen] = useState(false);
  const [pendingStep, setPendingStep] = useState<'quick' | 'program' | 'planned' | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AdHocOpenSession[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [childNavigation, setChildNavigation] = useState<NavigationContext | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [toast, setToast] = useState(false);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const running = useRef(false);
  const activeId = useRef<string | null>(null);
  const hasActive = sessions.some(row => row.status === 'active') || busy;
  useEffect(() => {
    ++generation.current; running.current = false; activeId.current = null;
    setBusy(false); setError(''); setSessionId(null); setSourceOpen(false); setPlannedOpen(false);
    setPendingStep(null); setChildNavigation(null); setSessions([]); setSessionsLoaded(false); setBlocked(false);
    return () => { ++generation.current; };
  }, [repository]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(false), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!repository) return;
    let active = true;
    const subscription = repository.observeOpen(rows => {
      if (!active) return;
      const current = rows.find(row => row.status === 'active');
      activeId.current = current?.id ?? null;
      setSessions(rows); setSessionsLoaded(true);
      // The Training tab resumes local work; it is not a separate navigation destination.
      if (current) setSessionId(id => id ?? current.id);
    }, reason => {
      if (active) { setError(adHocErrorMessage(reason, 'Не удалось прочитать тренировки')); setSessionsLoaded(false); }
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [repository, retry]);
  const closeSource = useCallback(() => { setSourceOpen(false); setChildNavigation(null); }, []);
  const closePlanned = useCallback(() => { setPlannedOpen(false); setChildNavigation(null); }, []);
  useEffect(() => {
    onNavigationContextChange(childNavigation ?? (plannedOpen
      ? { level: 2, title: 'Плановая тренировка', contentMode: 'viewport', onBack: closePlanned } : null));
    return () => onNavigationContextChange(null);
  }, [plannedOpen, closePlanned, childNavigation, onNavigationContextChange]);
  const openCreated = useCallback((result: { id: string; createdProgram: boolean }, token: number) => {
    if (token !== generation.current) return;
    activeId.current = result.id;
    setSessionId(result.id); setSourceOpen(false); setChildNavigation(null);
    setSessions(rows => [{ id: result.id, name: 'Тренировка', status: 'active' }, ...rows.filter(row => row.id !== result.id)]);
    if (result.createdProgram) setToast(true);
  }, []);
  const quick = useCallback(async () => {
    if (running.current || !repository) return;
    if (activeId.current) { setBlocked(true); return; }
    const token = generation.current;
    running.current = true; setBusy(true); setError('');
    try { openCreated(await repository.createQuick(), token); }
    catch (reason) {
      if (token !== generation.current) return;
      if (alreadyActive(reason)) setBlocked(true);
      else setError(adHocErrorMessage(reason, 'Не удалось создать тренировку'));
    } finally { if (token === generation.current) { running.current = false; setBusy(false); } }
  }, [repository, openCreated]);
  const startFromProgram = useCallback(async (input: StartInput) => {
    if (!repository) throw new Error('Не удалось прочитать тренировки');
    const token = generation.current;
    try {
      openCreated(await repository.createForAthlete(input.athleteUserId, input.programId, input.dayId), token);
    } catch (reason) {
      if (token !== generation.current) return;
      if (alreadyActive(reason)) { closeSource(); setBlocked(true); }
      else throw new Error(adHocErrorMessage(reason));
    }
  }, [repository, openCreated, closeSource]);
  const action = useMemo<NavigationFloatingAction | null>(() => {
    if (sourceOpen || plannedOpen) return null;
    const common = { label: 'Создать тренировку', icon: 'plus' as const, disabled: busy || !repository || !sessionsLoaded };
    if (hasActive) return { ...common, disabled: busy, onClick: () => setBlocked(true) };
    return { ...common, popoverItems: [
      { id: 'quick', label: 'Быстрая тренировка', icon: 'treadmill', onSelect: () => setPendingStep('quick') },
      { id: 'program', label: 'Из программы', icon: 'barbell', onSelect: () => setPendingStep('program') },
      { id: 'planned', label: 'Плановая тренировка', icon: 'calendar', onSelect: () => setPendingStep('planned') },
    ], onPresentationChange: presented => {
      if (presented || !pendingStep) return;
      const next = pendingStep; setPendingStep(null); setError('');
      if (activeId.current) { setBlocked(true); return; }
      if (next === 'quick') void quick();
      else if (next === 'program') setSourceOpen(true);
      else setPlannedOpen(true);
    } };
  }, [sourceOpen, plannedOpen, busy, repository, sessionsLoaded, hasActive, pendingStep, quick]);
  useNavigationFloatingAction('training', action);
  return <>
    {sessionId && repository ? <AdHocSessionScreen key={sessionId} repository={repository} sessionId={sessionId}
      initData={initData} actor={actor}
      onExerciseInformation={exerciseId => repository.exerciseInformation(sessionId, exerciseId)}
      onNavigationContextChange={setChildNavigation} /> : <section className="adhoc-workouts">
      <Text variant="headline">Тренировка</Text>
      <Text variant="body">Нажмите «+», чтобы начать тренировку.</Text>
      {sessions.length ? <List nested>{sessions.map(session => <ListItem key={session.id} link title={session.name}
        onClick={() => { if (!busy) { setError(''); setSessionId(session.id); } }} />)}</List> : null}
    </section>}
    {busy ? <Text variant="body" role="status">Создаём тренировку…</Text> : null}
    {cloud?.syncStatus === 'offline' || cloud?.syncStatus === 'error' ? <section className="adhoc-workouts">
      <Text variant="footnote" role="status">{cloud.syncStatus === 'offline'
        ? 'Нет соединения с Mezfit облаком. Изменения ожидают синхронизации.'
        : 'Не удалось синхронизировать данные с Mezfit облаком.'}</Text>
    </section> : null}
    {error ? <section className="adhoc-workouts"><Text variant="footnote" role="alert">{error}</Text>
      <Button rounded tonal disabled={busy} onClick={() => { setError(''); setRetry(value => value + 1); }}>Повторить</Button></section> : null}
    <ScheduleWorkoutCreator intent={sourceOpen ? 'workout' : null} role="coach" actor={actor} mode="start"
      onClose={closeSource} onCreated={ignoreScheduledCreation} onStartWorkout={startFromProgram}
      onNavigationContextChange={setChildNavigation} />
    <MezfitBottomSheet opened={plannedOpen} label="Плановая тренировка" lazyMount />
    <MezfitDialog opened={blocked} title="Завершите текущую тренировку, чтобы начать новую."
      onBackdropClick={() => setBlocked(false)}
      buttons={<MezfitDialogButton strong onClick={() => setBlocked(false)}>Понятно</MezfitDialogButton>} />
    <Toast opened={toast} position="center" role="status" aria-live="polite">
      <Text variant="body">Была создана программа.</Text>
    </Toast>
  </>;
}
