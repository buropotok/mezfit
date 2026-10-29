import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import { NavigationShell, type NavigationFloatingAction } from '../NavigationShell';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { ClientWorkoutRepository } from '../data/cloud/client-workouts';
import type { AdHocOpenSession } from '../data/cloud/adhoc-workouts';
import { adHocErrorMessage } from './adhoc-workout-errors';

interface ClientWorkoutState {
  repository: ClientWorkoutRepository | null;
  sessions: readonly AdHocOpenSession[];
  loaded: boolean;
  error: string;
  retry: () => void;
}
const Context = createContext<ClientWorkoutState | null>(null);
export const useClientWorkout = () => useContext(Context);

/** One account/role-scoped subscription survives tab navigation. */
export function ClientWorkoutProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const cloud = useCloudConnections();
  const repository = useMemo(() => enabled && cloud?.db
    ? new ClientWorkoutRepository(cloud.db, cloud.actorUserId) : null,
  [enabled, cloud?.db, cloud?.actorUserId]);
  const [snapshot, setSnapshot] = useState<{
    repository: ClientWorkoutRepository; sessions: AdHocOpenSession[]; error: string;
  } | null>(null);
  const [version, setVersion] = useState(0);
  const retry = useCallback(() => setVersion(value => value + 1), []);
  useEffect(() => {
    setSnapshot(null);
    if (!repository) return;
    let active = true;
    const subscription = repository.observeOpen(sessions => {
      if (active) setSnapshot({ repository, sessions, error: '' });
    }, reason => {
      if (active) setSnapshot({ repository, sessions: [], error: adHocErrorMessage(reason, 'Не удалось прочитать тренировки') });
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [repository, version]);
  // Never expose the previous account's or role's records during effect cleanup.
  const current = snapshot?.repository === repository ? snapshot : null;
  const value = useMemo<ClientWorkoutState>(() => ({ repository,
    sessions: current?.sessions ?? [], loaded: Boolean(current && !current.error),
    error: current?.error ?? '', retry }), [repository, current, retry]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** Navigation owns the global FAB; its label reads the same local session as Training. */
export function ClientWorkoutNavigationShell(props: ComponentProps<typeof NavigationShell>) {
  const workout = useClientWorkout();
  const active = workout?.sessions.some(session => session.status === 'active') ?? false;
  const action: NavigationFloatingAction | null = props.activeRole === 'client' ? {
    label: workout?.error ? 'Открыть тренировку' : active ? 'Продолжить тренировку' : 'Начать тренировку',
    placement: 'left', icon: 'barbell',
    isShown: props.destination !== 'training' && Boolean(workout?.loaded || workout?.error),
    onClick: () => props.onDestinationChange('training'),
  } : null;
  return <NavigationShell {...props} floatingAction={action} />;
}
