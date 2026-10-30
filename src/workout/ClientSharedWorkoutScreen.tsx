import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from 'konsta/react';
import type { NavigationContext } from '../NavigationShell';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { PlannedWorkoutsRepository, type UpcomingPlannedWorkout } from '../data/cloud/planned-workouts';
import type { ClientWorkoutRepository } from '../data/cloud/client-workouts';
import type { ProgramActor } from '../program/ProgramSummary';
import { OccurrenceDraftCard } from '../schedule/OccurrenceDraftSheet';
import { Text } from '../ui';
import { AdHocSessionScreen } from './AdHocSessionScreen';
import { useClientWorkout } from './ClientWorkoutContext';
import { usePlannedWorkoutStart } from './PlannedWorkoutStartContext';
import { adHocErrorMessage } from './adhoc-workout-errors';
import './adhoc-workouts.css';

const refusePlanSave = async () => { throw new Error('Изменение плана недоступно'); };
const ignoreClose = () => {};

/** Athlete execution and launch choices share the shell's local active-session projection. */
export function ClientSharedWorkoutScreen({ initData, actor, onNavigationContextChange }: {
  initData: string;
  actor?: ProgramActor;
  onNavigationContextChange: (value: NavigationContext | null) => void;
}) {
  const cloud = useCloudConnections();
  const workout = useClientWorkout();
  const start = usePlannedWorkoutStart();
  const repository = workout?.repository ?? null;
  const upcoming = useMemo(() => cloud?.db ? new PlannedWorkoutsRepository(cloud.db, cloud.actorUserId, 'client') : null,
    [cloud?.db, cloud?.actorUserId]);
  const [rows, setRows] = useState<UpcomingPlannedWorkout[]>([]);
  const [plansLoaded, setPlansLoaded] = useState(false);
  const [plansError, setPlansError] = useState('');
  const [retry, setRetry] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [retained, setRetained] = useState<{ repository: ClientWorkoutRepository; id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const running = useRef(false);
  const activeSessions = workout?.sessions.filter(row => row.status === 'active') ?? [];
  const activeId = activeSessions.find(row => retained?.repository === repository && row.id === retained.id)?.id
    ?? activeSessions[0]?.id ?? null;
  const sessionId = activeId ?? (retained?.repository === repository ? retained.id : null);
  useEffect(() => {
    ++generation.current; running.current = false;
    setRetained(null); setBusy(false); setError('');
    return () => { ++generation.current; };
  }, [repository]);
  useEffect(() => {
    if (repository && activeId) {
      setRetained({ repository, id: activeId });
    }
  }, [repository, activeId]);
  useEffect(() => {
    setRows([]); setPlansLoaded(false); setPlansError('');
    if (!upcoming || activeId) return;
    let active = true;
    const subscription = upcoming.observe(new Date(), rows => {
      if (active) { setRows(rows); setPlansLoaded(true); setPlansError(''); }
    }, reason => {
      if (active) { setPlansLoaded(true); setRows([]); setPlansError(adHocErrorMessage(reason, 'Не удалось прочитать плановые тренировки')); }
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [upcoming, activeId, retry]);
  const exerciseInformation = useCallback((exerciseId: string) => {
    if (!repository || !sessionId) return Promise.reject(new Error('Тренировка недоступна'));
    return repository.exerciseInformation(sessionId, exerciseId);
  }, [repository, sessionId]);
  const runStart = async (create: () => Promise<{ id: string }>) => {
    if (!repository || !workout?.loaded || running.current || activeId) return;
    const token = generation.current;
    running.current = true; setBusy(true); setError('');
    try {
      const { id } = await create();
      if (token !== generation.current) return;
      setRetained({ repository, id }); setExpandedId(null);
      start?.showSession(id);
    } catch (reason) {
      if (token === generation.current) setError(adHocErrorMessage(reason, 'Не удалось начать тренировку'));
      throw reason;
    } finally {
      if (token === generation.current) { running.current = false; setBusy(false); }
    }
  };
  return <>
    {sessionId && repository ? <AdHocSessionScreen key={sessionId} repository={repository} sessionId={sessionId}
      initData={initData} actor={actor} hideActiveStatus personalCatalogueRole="client"
      onExerciseInformation={exerciseInformation} onNavigationContextChange={onNavigationContextChange} /> : null}
    <section className="adhoc-workouts">
      {!workout?.loaded && !workout?.error ? <Text variant="body" role="status">Загружаем тренировки…</Text> : null}
      {workout?.error ? <><Text variant="footnote" role="alert">{workout.error}</Text>
        <Button rounded tonal onClick={workout.retry}>Повторить</Button></> : null}
      {workout?.loaded && !activeId ? <>
        <Text variant="headline">Начать тренировку</Text>
        <Button rounded disabled={busy || !start} onClick={() => {
          if (start) void runStart(() => start.startQuick()).catch(() => undefined);
        }}>Своя тренировка</Button>
        <Text variant="body">Запланированные тренировки</Text>
        {!plansLoaded ? <Text variant="body" role="status">Загружаем план…</Text> : null}
        {plansLoaded && !plansError && !rows.length ? <Text variant="footnote">На ближайшие две недели тренировок нет.</Text> : null}
        {plansError ? <><Text variant="footnote" role="alert">{plansError}</Text>
          <Button rounded tonal onClick={() => setRetry(value => value + 1)}>Повторить загрузку плана</Button></> : null}
        {upcoming ? rows.map(row => <OccurrenceDraftCard key={row.id} draft={row.draft} drafts={upcoming.drafts}
          actor={actor} sourceProgramName={row.programName} readOnly allowReadOnlyStart
          collapsed={expandedId !== row.id} onCollapsedChange={() => setExpandedId(id => id === row.id ? null : row.id)}
          onSave={refusePlanSave} onClose={ignoreClose} onNavigationContextChange={onNavigationContextChange}
          onStart={start && !busy ? draft => runStart(async () => ({ id: await start.start(draft) })) : undefined} />) : null}
      </> : null}
      {busy ? <Text variant="body" role="status">Начинаем тренировку…</Text> : null}
      {error ? <Text variant="footnote" role="alert">{error}</Text> : null}
    </section>
  </>;
}
