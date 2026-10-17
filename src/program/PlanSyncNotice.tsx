import type { NavigationContext } from '../NavigationShell';
import { useEffect, useState } from 'react';
import { Notification } from 'konsta/react';
import { createPortal } from 'react-dom';
import type { CloudSyncStatus } from '../data/cloud/CloudConnectionsProvider';
import { Button, Text } from '../ui';
import { ProgramSyncDialog } from './ProgramSyncDialog';

/** Local errors stay local; cloud recovery uses Konsta's notification callback. */
export function PlanSyncNotice({
  cloudStatus, cloudError, syncStatus, syncError, onRetryCloud, onRetrySync,
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
  const warning = syncStatus === 'error' ? syncError || 'Ошибка синхронизации с Dexie Cloud'
    : syncStatus === 'offline' ? syncError || 'Нет соединения с Dexie Cloud'
      : syncStatus === 'pending' ? 'Синхронизация с облаком ещё не подтверждена.' : '';
  const contactError = cloudStatus === 'error' ? cloudError || 'Не удалось загрузить облачные данные' : '';
  const message = [warning, contactError].filter(Boolean).join(' ');
  useEffect(() => { if (!message) setDismissed(''); }, [message]);
  const close = () => {
    setDismissed(message);
    // Closing after successful recovery must not resurrect an obsolete prompt.
    if (message) setOpened(true);
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
  const notification = <Notification opened={Boolean(message && message !== dismissed)}
    title="Синхронизация с облаком" text={message} button onClose={close} onClick={close} />;
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
