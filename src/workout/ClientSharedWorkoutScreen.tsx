import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { List, ListItem } from 'konsta/react';
import type { NavigationContext } from '../NavigationShell';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { AdHocWorkoutRepository, type AdHocOpenSession } from '../data/cloud/adhoc-workouts';
import { Text } from '../ui';
import { WorkoutSessionCard } from './WorkoutSessionCard';
import type { ActiveWorkoutSession } from './workoutSessionTypes';
import './adhoc-workouts.css';

/** Client-only projection of Coach-owned FACT; all edits stay with the Coach. */
function ClientSharedSession({ repository, sessionId, onNavigationContextChange }: {
  repository: AdHocWorkoutRepository;
  sessionId: string;
  onNavigationContextChange: (value: NavigationContext | null) => void;
}) {
  const [session, setSession] = useState<ActiveWorkoutSession<string> | null>(null);
  const [title, setTitle] = useState<string>();
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setSession(null); setTitle(undefined); setError('');
    const subscription = repository.observe(sessionId, (value, row) => {
      if (!active) return;
      setSession(value);
      setTitle(row?.name);
      setError(value ? '' : 'Тренировка недоступна');
    }, () => {
      if (!active) return;
      setSession(null); setError('Не удалось прочитать тренировку');
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [repository, sessionId]);
  return <>
    {session ? <WorkoutSessionCard readOnly session={session} title={title}
      onReorderExerciseIds={() => {}}
      onSaveSet={async () => { throw new Error('Редактирование доступно только тренеру'); }}
      onNavigationContextChange={onNavigationContextChange} /> : null}
    {error ? <Text variant="footnote" role="alert">{error}</Text> : null}
    {!session && !error ? <Text variant="body">Загружаем тренировку…</Text> : null}
  </>;
}

/** Existing client workout remains the fallback until an authorized shared FACT arrives. */
export function ClientSharedWorkoutScreen({ legacy, onNavigationContextChange }: {
  legacy: ReactNode;
  onNavigationContextChange: (value: NavigationContext | null) => void;
}) {
  const cloud = useCloudConnections();
  const repository = useMemo(() => cloud?.db
    ? new AdHocWorkoutRepository(cloud.db, cloud.actorUserId) : null, [cloud?.db, cloud?.actorUserId]);
  const [sessions, setSessions] = useState<AdHocOpenSession[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setSessions([]); setLoaded(false); setSelectedId(null); setError('');
    if (!repository) return;
    let active = true;
    const subscription = repository.observeForClient(rows => {
      if (!active) return;
      setSessions(rows); setLoaded(true); setError('');
    }, () => {
      if (!active) return;
      setSessions([]); setLoaded(true); setError('Не удалось прочитать тренировки из локальной базы');
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [repository]);

  if (!repository) return <>{legacy}</>;
  if (!loaded) return <section className="adhoc-workouts"><Text variant="body">Загружаем тренировки…</Text></section>;
  if (error) return <section className="adhoc-workouts"><Text variant="footnote" role="alert">{error}</Text></section>;
  if (!sessions.length) return <>{legacy}</>;

  const activeId = sessions.some(row => row.id === selectedId) ? selectedId : sessions[0].id;
  return <section className="adhoc-workouts">
    {sessions.length > 1 ? <List nested>{sessions.map(row =>
      <ListItem key={row.id} title={row.name} link onClick={() => setSelectedId(row.id)} />
    )}</List> : null}
    <ClientSharedSession key={activeId} repository={repository} sessionId={activeId}
      onNavigationContextChange={onNavigationContextChange} />
  </section>;
}
