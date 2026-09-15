import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getClientCoaches, type ClientCoachListItem } from '../api';

interface ClientCoachContextValue {
  coaches: ClientCoachListItem[];
  selectedCoach: ClientCoachListItem | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string;
  selectCoach: (coachUserId: number) => void;
  refreshCoaches: () => void;
}

const ClientCoachContext = createContext<ClientCoachContextValue | null>(null);

function storageKey(clientUserId: number): string {
  return `mezfit.selectedCoachUserId.${clientUserId}`;
}

function storedCoachUserId(clientUserId: number): number | null {
  const value = window.localStorage.getItem(storageKey(clientUserId));
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

interface ClientCoachProviderProps {
  initData: string;
  clientUserId: number;
  enabled: boolean;
  children: ReactNode;
}

export function ClientCoachProvider({ initData, clientUserId, enabled, children }: ClientCoachProviderProps) {
  const [coaches, setCoaches] = useState<ClientCoachListItem[]>([]);
  const [selectedCoachUserId, setSelectedCoachUserId] = useState<number | null>(null);
  const [status, setStatus] = useState<ClientCoachContextValue['status']>('idle');
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setCoaches([]);
      setSelectedCoachUserId(null);
      setStatus('idle');
      setError('');
      return undefined;
    }

    let cancelled = false;
    setStatus('loading');
    setError('');

    getClientCoaches(initData)
      .then(({ coaches: nextCoaches }) => {
        if (cancelled) return;
        setCoaches(nextCoaches);
        setSelectedCoachUserId((current) => {
          const currentExists = current !== null && nextCoaches.some((coach) => coach.user.id === current);
          if (currentExists) return current;

          const stored = storedCoachUserId(clientUserId);
          const next = (stored !== null && nextCoaches.some((coach) => coach.user.id === stored))
            ? stored
            : nextCoaches[0]?.user.id ?? null;

          if (next === null) window.localStorage.removeItem(storageKey(clientUserId));
          else window.localStorage.setItem(storageKey(clientUserId), String(next));
          return next;
        });
        setStatus('ready');
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setCoaches([]);
        setSelectedCoachUserId(null);
        setStatus('error');
        setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить тренеров');
      });

    return () => { cancelled = true; };
  }, [clientUserId, enabled, initData, refreshKey]);

  const selectCoach = useCallback((coachUserId: number) => {
    if (!coaches.some((coach) => coach.user.id === coachUserId)) return;
    setSelectedCoachUserId(coachUserId);
    window.localStorage.setItem(storageKey(clientUserId), String(coachUserId));
  }, [clientUserId, coaches]);

  const refreshCoaches = useCallback(() => {
    if (enabled) setRefreshKey((value) => value + 1);
  }, [enabled]);

  const selectedCoach = useMemo(
    () => coaches.find((coach) => coach.user.id === selectedCoachUserId) ?? null,
    [coaches, selectedCoachUserId],
  );

  const value = useMemo<ClientCoachContextValue>(() => ({
    coaches,
    selectedCoach,
    status,
    error,
    selectCoach,
    refreshCoaches,
  }), [coaches, error, refreshCoaches, selectCoach, selectedCoach, status]);

  return <ClientCoachContext.Provider value={value}>{children}</ClientCoachContext.Provider>;
}

export function useClientCoach(): ClientCoachContextValue {
  const context = useContext(ClientCoachContext);
  if (!context) throw new Error('useClientCoach must be used inside ClientCoachProvider');
  return context;
}
