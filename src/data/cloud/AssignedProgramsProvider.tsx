import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AssignedProgramsRepository } from './assigned-programs';
import type { CloudTrainingPlanRow } from './database';

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
  telegramUserId, initData, children,
}: { telegramUserId: string; initData: string; children: ReactNode }) {
  const repository = useMemo(
    () => new AssignedProgramsRepository(telegramUserId, initData),
    [telegramUserId, initData],
  );
  const [plans, setPlans] = useState<CloudTrainingPlanRow[]>([]);
  const [status, setStatus] = useState<AssignedProgramsContextValue['status']>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
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

  const value = useMemo<AssignedProgramsContextValue>(() => ({
    repository,
    actorUserId: repository.actorUserId,
    plans,
    status,
    error,
    refresh: () => repository.refresh(),
  }), [repository, plans, status, error]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** Non-program screens are not forced to instantiate Dexie Cloud. */
export function useAssignedPrograms(): AssignedProgramsContextValue | null {
  return useContext(Context);
}
