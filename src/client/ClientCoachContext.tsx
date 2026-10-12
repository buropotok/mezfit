import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useCloudConnections, type CloudContact } from '../data/cloud/CloudConnectionsProvider';

interface ClientCoachContextValue {
  coaches: CloudContact[];
  selectedCoach: CloudContact | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string;
  selectCoach: (coachUserId: string) => void;
  refreshCoaches: () => void;
}

const ClientCoachContext = createContext<ClientCoachContextValue | null>(null);

function storageKey(clientTelegramUserId: string): string {
  return `mezfit.selectedCloudCoachUserId.${clientTelegramUserId}`;
}

function storedCoachUserId(clientTelegramUserId: string): string | null {
  const stored = window.localStorage.getItem(storageKey(clientTelegramUserId));
  return stored && /^tg:[1-9]\d*$/.test(stored) ? stored : null;
}

interface ClientCoachProviderProps {
  clientTelegramUserId: string;
  enabled: boolean;
  children: ReactNode;
}

export function ClientCoachProvider({ clientTelegramUserId, enabled, children }: ClientCoachProviderProps) {
  const cloud = useCloudConnections();
  const [selectedCoachUserId, setSelectedCoachUserId] = useState<string | null>(null);
  const coaches = useMemo(() => enabled ? cloud?.coaches ?? [] : [], [cloud?.coaches, enabled]);
  const status = !enabled ? 'idle' : cloud?.status ?? 'error';
  const error = cloud?.error ?? 'Dexie Cloud недоступен';

  useEffect(() => {
    if (!enabled) {
      setSelectedCoachUserId(null);
      return;
    }
    if (status !== 'ready') return;
    setSelectedCoachUserId((current) => {
      const available = (id: string | null): id is string =>
        id !== null && coaches.some((coach) => coach.userId === id);
      const next = available(current) ? current
        : available(storedCoachUserId(clientTelegramUserId)) ? storedCoachUserId(clientTelegramUserId)
          : coaches[0]?.userId ?? null;
      if (next === null) window.localStorage.removeItem(storageKey(clientTelegramUserId));
      else window.localStorage.setItem(storageKey(clientTelegramUserId), next);
      return next;
    });
  }, [clientTelegramUserId, coaches, enabled, status]);

  const selectCoach = useCallback((coachUserId: string) => {
    if (!coaches.some((coach) => coach.userId === coachUserId)) return;
    setSelectedCoachUserId(coachUserId);
    window.localStorage.setItem(storageKey(clientTelegramUserId), coachUserId);
  }, [clientTelegramUserId, coaches]);

  const refreshCoaches = useCallback(() => {
    if (enabled) void cloud?.refresh().catch(() => undefined);
  }, [cloud, enabled]);

  const selectedCoach = useMemo(
    () => coaches.find((coach) => coach.userId === selectedCoachUserId) ?? null,
    [coaches, selectedCoachUserId],
  );

  const value = useMemo<ClientCoachContextValue>(() => ({
    coaches, selectedCoach, status, error, selectCoach, refreshCoaches,
  }), [coaches, selectedCoach, status, error, selectCoach, refreshCoaches]);

  return <ClientCoachContext.Provider value={value}>{children}</ClientCoachContext.Provider>;
}

export function useClientCoach(): ClientCoachContextValue {
  const context = useContext(ClientCoachContext);
  if (!context) throw new Error('useClientCoach must be used inside ClientCoachProvider');
  return context;
}
