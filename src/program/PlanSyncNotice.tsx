import type { NavigationContext } from '../NavigationShell';
import { useEffect, useRef, useState } from 'react';
import { Notification } from 'konsta/react';
import { createPortal } from 'react-dom';
import type { CloudSyncStatus } from '../data/cloud/CloudConnectionsProvider';
import { useSyncNotificationBudget } from '../data/cloud/sync-notification-budget';
import { Button, Text } from '../ui';
import { ProgramSyncDialog } from './ProgramSyncDialog';

/** Local errors stay local; cloud recovery uses Konsta's notification callback. */
export function PlanSyncNotice({
  cloudStatus, syncStatus, onRetryCloud, onRetrySync,
  localError = '', onRetryLocal, onNavigationContextChange,
}: {
  onNavigationContextChange?: (context: NavigationContext | null) => void;
  cloudStatus: 'loading' | 'ready' | 'error';
  cloudError: string;
  syncStatus: CloudSyncStatus;
  syncError: string;
  onRetryCloud: () => Promise<void>;
  onRetrySync: () => Promise<void>;
  localError?: string;
  onRetryLocal?: () => void;
}) {
  const [dismissed, setDismissed] = useState('');
  const [opened, setOpened] = useState(false);
  const budget = useSyncNotificationBudget();
  const observed = useRef('');
  const [admitted, setAdmitted] = useState('');
  const warning = syncStatus === 'error' ? 'Не удалось отправить изменения в Mezfit облако.' : '';
  const contactError = cloudStatus === 'error' ? 'Не удалось получить данные из Mezfit облака.' : '';
  const message = [warning, contactError].filter(Boolean).join(' ');
  useEffect(() => {
    // StrictMode effect replay must not charge twice for one displayed notice.
    if (observed.current === message) return;
    observed.current = message;
    if (!message) {
      setDismissed('');
      setAdmitted('');
    } else {
      setAdmitted(message !== dismissed && (!budget || budget.claim()) ? message : '');
    }
  }, [message, budget, dismissed]);
  const close = () => {
    if (!message || message === dismissed || (budget && admitted !== message)) return;
    setDismissed(message);
    // Closing after successful recovery must not resurrect an obsolete prompt.
    setOpened(true);
  };
  const retry = async () => {
    let failure: unknown;
    try { await onRetrySync(); } catch (reason) { failure = reason; }
    if (cloudStatus === 'error') {
      try { await onRetryCloud(); } catch (reason) { failure ??= reason; }
    }
    onRetryLocal?.();
    if (failure) throw failure;
  };
  const notification = <Notification opened={Boolean(message && message !== dismissed && (!budget || admitted === message))}
    title="Mezfit облако" text={message} button onClose={close} onClick={close} />;
  return <>
    {localError ? <div className="cloud-plan-error">
      <Text variant="footnote" role="alert">{localError}</Text>
      {onRetryLocal ? <Button onClick={onRetryLocal}>Повторить</Button> : null}
    </div> : null}
    {typeof document === 'undefined' ? notification
      : createPortal(notification, document.getElementById('root') ?? document.body)}
    <ProgramSyncDialog opened={opened} onClose={() => setOpened(false)} onSync={retry} onNavigationContextChange={onNavigationContextChange} />
  </>;
}
