import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AssignedProgramsRepository } from './assigned-programs';
import type { CloudTrainingPlanRow } from './database';
import { useCloudConnections } from './CloudConnectionsProvider';

interface AssignedProgramsContextValue {
  repository: AssignedProgramsRepository;
  actorUserId: string;
  plans: CloudTrainingPlanRow[];
  status: 'loading' | 'ready' | 'error';
  error: string;
  refresh: () => Promise<void>;
}

const Context = createContext<AssignedProgramsContextValue | null>(null);

export function AssignedProgramsProvider({
  telegramUserId, initData, enabled, children,
}: { telegramUserId: string; initData: string; enabled: boolean; children: ReactNode }) {
  const cloud = useCloudConnections();
  const [retryKey, setRetryKey] = useState(0);
  const repository = useMemo(
    () => enabled && cloud ? new AssignedProgramsRepository(telegramUserId, initData, cloud.db) : null,
    [telegramUserId, initData, enabled, cloud?.db, retryKey],
  );
  const [plans, setPlans] = useState<CloudTrainingPlanRow[]>([]);
  const [status, setStatus] = useState<AssignedProgramsContextValue['status']>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!repository) return undefined;
    setStatus('loading');
    setPlans([]);
    setError('');
    let active = true;
    const subscription = repository.observe(
      (rows) => {
        if (!active) return;
        setPlans(rows);
        setError('');
        setStatus('ready');
      },
      (reason) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : 'Не удалось открыть локальные программы');
        setStatus('error');
      },
    );
    return () => {
      active = false;
      subscription.unsubscribe();
      repository.close();
    };
  }, [repository]);

  const value = useMemo<AssignedProgramsContextValue | null>(() => repository ? ({
    repository,
    actorUserId: repository.actorUserId,
    plans,
    status,
    error,
    refresh: async () => { setRetryKey((value) => value + 1); },
  }) : null, [repository, plans, status, error]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** Non-program screens are not forced to instantiate Dexie Cloud. */
export function useAssignedPrograms(): AssignedProgramsContextValue | null {
  return useContext(Context);
}
