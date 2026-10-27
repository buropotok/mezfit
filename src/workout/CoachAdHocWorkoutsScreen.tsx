import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, List, ListItem, Toast } from 'konsta/react';
import { useNavigationFloatingAction, type NavigationContext } from '../NavigationShell';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { AdHocWorkoutRepository } from '../data/cloud/adhoc-workouts';
import type { CloudTrainingPlanRow } from '../data/cloud/database';
import type { ProgramActor } from '../program/ProgramSummary';
import { ProgramClientPicker } from '../program/ProgramClientPicker';
import { MezfitBottomSheet, MezfitDialog, MezfitDialogButton, Text } from '../ui';
import { AdHocProgramPicker } from './AdHocProgramPicker';
import { AdHocSessionScreen } from './AdHocSessionScreen';
import { adHocErrorMessage } from './adhoc-workout-errors';
import '../schedule/workout-planning.css';
import './adhoc-workouts.css';

type Step = 'athlete' | 'client' | 'programs' | 'planned' | null;

export function CoachAdHocWorkoutsScreen({ initData, actor, onClose, onNavigationContextChange }: {
  initData: string;
  actor?: ProgramActor;
  onClose: () => void;
  onNavigationContextChange: (value: NavigationContext | null) => void;
}) {
  const cloud = useCloudConnections();
  const repository = useMemo(() => cloud ? new AdHocWorkoutRepository(cloud.db, cloud.actorUserId) : null,
    [cloud?.db, cloud?.actorUserId]);
  const [step, setStep] = useState<Step>(null);
  const [pendingStep, setPendingStep] = useState<'quick' | 'athlete' | 'planned' | null>(null);
  const [athleteId, setAthleteId] = useState('');
  const [programs, setPrograms] = useState<CloudTrainingPlanRow[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<{ id: string; name: string }[]>([]);
  const [childNavigation, setChildNavigation] = useState<NavigationContext | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(false);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const running = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    ++generation.current;
    running.current = false;
    setBusy(false); setError(''); setSessionId(null); setStep(null);
    setPendingStep(null); setChildNavigation(null); setSessions([]);
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
    const subscription = repository.observeOpen(rows => { if (active) setSessions(rows); }, reason => {
      if (active) setError(adHocErrorMessage(reason, 'Не удалось прочитать тренировки'));
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [repository, retry]);
  const run = useCallback(async (operation: () => Promise<void>) => {
    if (running.current || !repository) return;
    const token = generation.current;
    running.current = true; setBusy(true); setError('');
    try { await operation(); }
    catch (reason) { if (token === generation.current) setError(adHocErrorMessage(reason, 'Не удалось создать тренировку')); }
    finally { if (token === generation.current) { running.current = false; setBusy(false); } }
  }, [repository]);
  const openCreated = useCallback((result: { id: string; createdProgram: boolean }, token: number) => {
    if (token !== generation.current) return;
    setSessionId(result.id); setStep(null); setChildNavigation(null);
    if (result.createdProgram) setToast(true);
  }, []);
  const quick = useCallback(() => run(async () => {
    if (!repository) return;
    const token = generation.current;
    openCreated(await repository.createQuick(), token);
  }), [repository, run, openCreated]);
  const selectAthlete = useCallback((id: string) => run(async () => {
    if (!repository) return;
    const token = generation.current;
    const rows = await repository.listPrograms(id);
    if (token !== generation.current) return;
    setAthleteId(id);
    if (!rows.length) openCreated(await repository.createForAthlete(id), token);
    else { setPrograms(rows); setStep('programs'); setChildNavigation(null); }
  }), [repository, run, openCreated]);
  const startDay = useCallback((programId: string, dayId: string) => { void run(async () => {
    if (!repository) return;
    const token = generation.current;
    openCreated(await repository.createForAthlete(athleteId, programId, dayId), token);
  }); }, [repository, athleteId, run, openCreated]);
  const back = useCallback(() => {
    if (running.current) return;
    setError(''); setChildNavigation(null);
    if (step === 'client' || step === 'programs') setStep('athlete');
    else if (step) setStep(null);
    else if (sessionId) setSessionId(null);
    else onCloseRef.current();
  }, [step, sessionId]);
  useEffect(() => {
    const title = step === 'planned' ? 'Плановая тренировка' : step === 'client' ? 'Выбрать клиента'
      : step === 'programs' ? 'Выбрать программу' : step === 'athlete' ? 'Из программы' : 'Тренировка';
    onNavigationContextChange(childNavigation ?? (step || sessionId
      ? { level: 2, title, contentMode: 'viewport', onBack: back } : null));
    return () => onNavigationContextChange(null);
  }, [step, sessionId, back, childNavigation, onNavigationContextChange]);
  const action = useMemo(() => step || sessionId ? null : {
    label: 'Создать тренировку', icon: 'plus' as const, disabled: busy || !repository,
    popoverItems: [
      { id: 'quick', label: 'Быстрая тренировка', icon: 'treadmill' as const,
        onSelect: () => setPendingStep('quick') },
      { id: 'program', label: 'Из программы', icon: 'barbell' as const,
        onSelect: () => setPendingStep('athlete') },
      { id: 'planned', label: 'Плановая тренировка', icon: 'calendar' as const,
        onSelect: () => setPendingStep('planned') },
    ],
    onPresentationChange: (presented: boolean) => {
      if (presented || !pendingStep) return;
      const next = pendingStep; setPendingStep(null); setError('');
      if (next === 'quick') void quick(); else setStep(next);
    },
  }, [step, sessionId, busy, repository, pendingStep, quick]);
  useNavigationFloatingAction('training', action);
  return <>
    {sessionId && repository ? <AdHocSessionScreen key={sessionId} repository={repository} sessionId={sessionId}
      initData={initData} actor={actor} onNavigationContextChange={setChildNavigation} /> : <section className="adhoc-workouts">
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
      <Button tonal disabled={busy} onClick={() => { setError(''); setRetry(value => value + 1); }}>Повторить</Button></section> : null}
    <MezfitDialog opened={step === 'athlete'} title="Из программы"
      onBackdropClick={busy ? undefined : back}
      buttons={<MezfitDialogButton disabled={busy} onClick={back}>Отмена</MezfitDialogButton>}>
      <List nested>
        <ListItem link title="Моя тренировка" onClick={() => { if (cloud && !busy) void selectAthlete(cloud.actorUserId); }} />
        <ListItem link title="Выбрать клиента" onClick={() => { if (!busy) setStep('client'); }} />
      </List>
      {error ? <Text variant="footnote" role="alert">{error}</Text> : null}
    </MezfitDialog>
    <ProgramClientPicker opened={step === 'client'} clients={cloud?.clients ?? []}
      loading={cloud?.status === 'loading' || busy} onClose={back}
      onSelect={client => { if (!busy) void selectAthlete(client.userId); }} />
    <MezfitBottomSheet opened={step === 'programs'} label="Выбрать программу" lazyMount>
      {repository && step === 'programs' ? <AdHocProgramPicker repository={repository} programs={programs}
        actor={actor} busy={busy} onStart={startDay} onBack={back} onNavigationContextChange={setChildNavigation} /> : null}
      {error ? <Text variant="footnote" role="alert">{error}</Text> : null}
    </MezfitBottomSheet>
    <MezfitBottomSheet opened={step === 'planned'} label="Плановая тренировка" lazyMount />
    <Toast opened={toast} position="center" role="status" aria-live="polite">
      <Text variant="body">Была создана программа.</Text>
    </Toast>
  </>;
}
