import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button as KonstaButton, List as KonstaList, ListItem as KonstaListItem } from 'konsta/react';
import type { NavigationContext } from '../NavigationShell';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { WorkoutPlanningRepository } from '../data/cloud/workout-planning';
import type { CloudTrainingPlanRow } from '../data/cloud/database';
import type { ProgramActor } from '../program/ProgramSummary';
import { ProgramClientPicker } from '../program/ProgramClientPicker';
import { CloudProgramDetailsPage } from '../program/CloudProgramDetailsPage';
import { Badge, MezfitBottomSheet, MezfitDialog, MezfitDialogButton, Text } from '../ui';
import './workout-planning.css';

type Step = 'athlete' | 'client' | 'source' | 'format' | 'programs' | 'details' | 'event';

export function ScheduleWorkoutCreator({ intent, role, actor, onClose, onCreated, onNavigationContextChange }: {
  intent: 'workout' | 'event' | null; role: 'coach' | 'client'; actor?: ProgramActor;
  onClose: () => void;
  onCreated: (id: string, clientUserId: string | null, notice: string) => void;
  onNavigationContextChange: (value: NavigationContext | null) => void;
}) {
  const cloud = useCloudConnections();
  const planner = useMemo(() => cloud ? new WorkoutPlanningRepository(cloud.db, cloud.actorUserId) : null,
    [cloud?.db, cloud?.actorUserId]);
  const [step, setStep] = useState<Step>('athlete');
  const [athlete, setAthlete] = useState('');
  const [programs, setPrograms] = useState<CloudTrainingPlanRow[]>([]);
  const [planId, setPlanId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [nestedNavigation, setNestedNavigation] = useState<NavigationContext | null>(null);
  const generation = useRef(0);
  const running = useRef(false);
  useEffect(() => {
    ++generation.current; running.current = false; setBusy(false); setError(''); setPlanId(null);
    setNestedNavigation(null); setAthlete(cloud?.actorUserId ?? '');
    setStep(intent === 'event' ? 'event' : role === 'coach' ? 'athlete' : 'source');
    return () => { ++generation.current; };
  }, [intent, role, cloud?.actorUserId]);
  const back = useCallback(() => {
    if (running.current) return;
    setError(''); setNestedNavigation(null);
    if (step === 'client') setStep('athlete');
    else if (step === 'source') { if (role === 'coach') setStep('athlete'); else onClose(); }
    else if (step === 'format' || step === 'programs') setStep('source');
    else if (step === 'details') { setPlanId(null); setStep('programs'); }
    else onClose();
  }, [step, role, onClose]);
  useEffect(() => {
    if (!intent) return;
    const title = step === 'event' ? 'Событие' : step === 'client' ? 'Выбрать клиента'
      : step === 'details' ? 'Программа тренировок' : step === 'programs' ? 'Выбрать программу' : 'Создать тренировку';
    onNavigationContextChange(nestedNavigation ?? { level: 2, title, contentMode: 'viewport', onBack: back });
    return () => onNavigationContextChange(null);
  }, [intent, step, back, nestedNavigation, onNavigationContextChange]);
  const run = async (work: (token: number) => Promise<void>) => {
    if (running.current || !planner) return;
    const token = generation.current;
    running.current = true; setBusy(true); setError('');
    try { await work(token); }
    catch (reason) { if (token === generation.current) setError(reason instanceof Error ? reason.message : 'Не удалось создать тренировку'); }
    finally { if (token === generation.current) { running.current = false; setBusy(false); } }
  };
  const create = (format: 'coached' | 'independent') => run(async token => {
    if (!planner) return;
    const result = await planner.createBlank(athlete, format);
    if (token === generation.current) onCreated(result.id,
      format === 'independent' && athlete !== planner.actorUserId ? athlete : null,
      result.createdProgram ? 'Создана программа «Программа тренировок» с фазой и днём «Тренировка».' : '');
  });
  const fromProgram = () => run(async token => {
    if (!planner) return;
    // Source selection includes coach assignments; export targets stay authorable-only.
    const rows = role === 'client'
      ? await planner.programs.listForAthlete()
      : await planner.programs.listForScheduling(athlete);
    if (token !== generation.current) return;
    setPrograms(rows);
    setPlanId(null); setStep('programs');
  });
  const isDialog = intent === 'workout' && ['athlete', 'source', 'format'].includes(step);
  const sheetOpen = intent === 'event' || (intent === 'workout' && (step === 'programs' || step === 'details'));
  return <>
    <MezfitDialog opened={isDialog} title={step === 'athlete' ? 'Создать тренировку' : step === 'format' ? 'Формат тренировки' : 'Источник тренировки'}
      buttons={<MezfitDialogButton disabled={busy} onClick={back}>Назад</MezfitDialogButton>}>
      <KonstaList nested>
        {step === 'athlete' ? <>
          <KonstaListItem link title="Моя тренировка" onClick={() => { setAthlete(cloud?.actorUserId ?? ''); setStep('source'); }} />
          <KonstaListItem link title="Выбрать клиента" onClick={() => setStep('client')} />
        </> : step === 'source' ? <>
          <KonstaListItem link title="Создать с нуля" onClick={() => {
            if (busy) return;
            if (athlete === planner?.actorUserId) void create('independent'); else setStep('format');
          }} />
          <KonstaListItem link title="Выбрать из программы" onClick={() => { if (!busy) void fromProgram(); }} />
        </> : <>
          <KonstaListItem link title="С тренером в зале" onClick={() => { if (!busy) void create('coached'); }} />
          <KonstaListItem link title="Самостоятельная" onClick={() => { if (!busy) void create('independent'); }} />
        </>}
      </KonstaList>
      {busy ? <Text variant="body">Создаём тренировку…</Text> : null}
      {error ? <Text variant="footnote" role="alert">{error}</Text> : null}
    </MezfitDialog>
    <ProgramClientPicker opened={intent === 'workout' && step === 'client'} clients={cloud?.clients ?? []}
      loading={cloud?.status === 'loading'} onClose={back}
      onSelect={client => { setAthlete(client.userId); setStep('source'); }} />
    <MezfitBottomSheet opened={sheetOpen} label={intent === 'event' ? 'Событие' : 'Выбрать программу'} lazyMount>
      <section className="workout-planning-sheet">
        <header className="workout-planning-sheet__header">
          <span />
          <KonstaButton clear inline disabled={busy} onClick={back}>Назад</KonstaButton>
        </header>
        {intent !== 'event' ? <>
          {error ? <Text variant="footnote" role="alert">{error}</Text> : null}
          {step === 'details' && planId && planner && cloud ? <CloudProgramDetailsPage key={planId}
            repository={planner.programs} planId={planId} viewerRole={role} actor={actor} selectionMode
            readOnly={role === 'client' && Boolean(programs.find(plan => plan.id === planId)?.coachUserId)}
            cloudStatus={cloud.status} cloudError={cloud.error} syncStatus={cloud.syncStatus} syncError={cloud.syncError}
            onRetryCloud={cloud.refresh} onRetrySync={cloud.retrySync} onNavigationContextChange={setNestedNavigation} /> : null}
          {step === 'programs' ? <>
            <Text variant="headline">Выбрать программу</Text>
            <KonstaList nested>{programs.map(plan => <KonstaListItem key={plan.id} link title={plan.name}
              subtitle={role === 'client' && plan.coachUserId && plan.status !== 'active'
                ? 'Только просмотр: для планирования тренер должен активировать программу и фазу.' : undefined}
              after={<Badge color={plan.status === 'active' ? 'green' : plan.status === 'finished' ? 'blue' : plan.status === 'cancelled' ? 'red' : 'gray'}>
                {plan.status === 'active' ? 'Активная' : plan.status === 'draft' ? 'Черновик' : plan.status === 'finished' ? 'Завершена' : 'Отменена'}
              </Badge>}
              onClick={() => { setPlanId(plan.id); setStep('details'); }} />)}</KonstaList>
            {!programs.length ? <Text variant="body">У атлета пока нет программ</Text> : null}
          </> : null}
          <KonstaButton tonal onClick={() => setStep('source')}>Создать с нуля</KonstaButton>
        </> : null}
      </section>
    </MezfitBottomSheet>
  </>;
}
