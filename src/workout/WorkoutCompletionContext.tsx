import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Toast } from 'konsta/react';
import type { NavigationContext } from '../NavigationShell';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { WorkoutCompletionReviewRepository } from '../data/cloud/workout-completion-review';
import type { CloudWorkoutOccurrenceRow } from '../data/cloud/workout-foundation-types';
import { Text } from '../ui';
import { WorkoutCompletionSheet } from './WorkoutCompletionSheet';
import { adHocErrorMessage } from './adhoc-workout-errors';

interface CompletionReview {
  active: boolean;
  /** Called only by the initiating screen after its explicit completion has committed. */
  reviewCompleted: (sessionId: string) => void;
}
const Context = createContext<CompletionReview | null>(null);
export const useWorkoutCompletionReview = () => useContext(Context);

/** Shell-owned review survives the active session screen disappearing after completion. */
export function WorkoutCompletionProvider({ enabled, scope, onNavigationContextChange, children }: {
  enabled: boolean; scope: string; children: ReactNode;
  onNavigationContextChange: (context: NavigationContext | null) => void;
}) {
  const cloud = useCloudConnections();
  const repository = useMemo(() => enabled && cloud
    ? new WorkoutCompletionReviewRepository(cloud.db, cloud.actorUserId) : null,
    [enabled, cloud?.db, cloud?.actorUserId]);
  const activeScope = useRef({ scope, repository }); activeScope.current = { scope, repository };
  const alive = useRef(false);
  const seen = useRef(new Set<string>());
  const ignored = useRef(new Set<string>());
  const running = useRef(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [rows, setRows] = useState<CloudWorkoutOccurrenceRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    seen.current.clear(); ignored.current.clear(); running.current = false;
    setSessionId(null); setRows([]); setBusy(false); setError('');
    onNavigationContextChange(null);
  }, [repository, scope, onNavigationContextChange]);
  const current = useCallback(() => alive.current && activeScope.current.scope === scope
    && activeScope.current.repository === repository, [scope, repository]);
  const close = useCallback(() => {
    if (running.current) return;
    setSessionId(null); setRows([]); setError('');
  }, []);
  const reviewCompleted = useCallback((id: string) => {
    if (!repository || !current() || seen.current.has(id)) return;
    seen.current.add(id); ignored.current.clear();
    setRows([]); setSessionId(id); setError('');
  }, [repository, current]);
  useEffect(() => {
    if (!repository || !sessionId) return;
    let active = true;
    const subscription = repository.observe(sessionId, value => {
      if (!active || !current()) return;
      const remaining = value.filter(row => !ignored.current.has(row.id));
      setRows(remaining);
      if (!remaining.length) setSessionId(null);
    }, reason => {
      if (active && current()) {
        setRows([]);
        setError(adHocErrorMessage(reason, 'Тренировка завершена. Не удалось проверить пересечения'));
      }
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [repository, sessionId, retry, current]);
  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(''), 5000);
    return () => window.clearTimeout(timer);
  }, [error]);
  const keep = (id: string) => {
    if (running.current) return;
    ignored.current.add(id);
    const remaining = rows.filter(row => row.id !== id);
    setRows(remaining);
    if (!remaining.length) setSessionId(null);
  };
  const resolve = async (row: CloudWorkoutOccurrenceRow, startsAtUtc?: string) => {
    if (!repository || !sessionId || running.current) return;
    running.current = true; setBusy(true); setError('');
    try {
      if (startsAtUtc === undefined) await repository.cancel(sessionId, row.id);
      else await repository.move(sessionId, row.id, startsAtUtc);
      // The live projection removes moved/cancelled rows. Never optimistically remove a failed write.
    } catch (reason) {
      if (current()) setError(adHocErrorMessage(reason));
    } finally {
      if (current()) { running.current = false; setBusy(false); }
    }
  };
  return <Context.Provider value={repository ? { active: sessionId !== null, reviewCompleted } : null}>
    {children}
    {sessionId && rows.length > 0 ? <WorkoutCompletionSheet rows={rows} busy={busy} onClose={close}
      onKeep={keep} onCancel={row => { void resolve(row); }} onMove={(row, time) => { void resolve(row, time); }}
      onError={reason => setError(adHocErrorMessage(reason))}
      onNavigationContextChange={onNavigationContextChange} /> : null}
    {error ? <Toast opened position="center" role="alert"><Text variant="body">{error}</Text>
      {sessionId && !rows.length ? <Button small rounded inline onClick={() => setRetry(value => value + 1)}>
        <Text variant="body">Повторить проверку</Text>
      </Button> : null}
    </Toast> : null}
  </Context.Provider>;
}
