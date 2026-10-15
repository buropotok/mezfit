import { useEffect, useRef, useState } from 'react';
import type { CloudSyncStatus } from '../data/cloud/CloudConnectionsProvider';
import { Button, Text } from '../ui';

/** Every PLAN surface uses the same cloud confirmation and recovery contract. */
export function PlanSyncNotice({
  cloudStatus, cloudError, syncStatus, syncError, onRetryCloud, onRetrySync,
  localError = '', onRetryLocal,
}: {
  cloudStatus: 'loading' | 'ready' | 'error';
  cloudError: string;
  syncStatus: CloudSyncStatus;
  syncError: string;
  onRetryCloud: () => Promise<void>;
  onRetrySync: () => Promise<void>;
  localError?: string;
  onRetryLocal?: () => void;
}) {
  const retrying = useRef(false);
  const [busy, setBusy] = useState(false);
  const [retryError, setRetryError] = useState('');
  useEffect(() => {
    if (syncStatus === 'synced' && cloudStatus === 'ready') setRetryError('');
  }, [syncStatus, cloudStatus]);
  const warning = syncStatus === 'error'
    ? syncError || 'Ошибка синхронизации с Dexie Cloud'
    : syncStatus === 'offline'
      ? syncError || 'Нет соединения с Dexie Cloud'
      : syncStatus === 'pending' ? 'Синхронизация с облаком ещё не подтверждена.' : '';
  const contactError = cloudStatus === 'error'
    ? cloudError || 'Не удалось загрузить облачные данные' : '';
  const canRetry = Boolean(localError || contactError)
    || syncStatus === 'error' || syncStatus === 'offline';

  const retry = async () => {
    if (retrying.current) return;
    retrying.current = true;
    setBusy(true);
    setRetryError('');
    let failure: unknown;
    try {
      // Always retry queued writes, even when the visible error concerns contacts.
      try { await onRetrySync(); } catch (reason) { failure = reason; }
      // A successful PLAN sync alone does not refresh failed contact hydration.
      if (cloudStatus === 'error') {
        try { await onRetryCloud(); } catch (reason) { failure ??= reason; }
      }
      onRetryLocal?.();
      if (failure) setRetryError(failure instanceof Error ? failure.message : 'Не удалось повторить синхронизацию');
    } finally {
      retrying.current = false;
      setBusy(false);
    }
  };

  if (!localError && !contactError && !warning && !retryError) return null;
  return (
    <div className="cloud-plan-error">
      {localError || contactError ? (
        <Text variant="footnote" role="alert">{localError || contactError}</Text>
      ) : null}
      {warning ? (
        <>
          <Text variant="footnote" role={syncStatus === 'pending' ? 'status' : 'alert'}>{warning}</Text>
          <Text variant="footnote" tone="muted">
            Изменения могут оставаться только на этом устройстве до завершения синхронизации.
          </Text>
        </>
      ) : null}
      {retryError ? <Text variant="footnote" role="alert">{retryError}</Text> : null}
      {canRetry || retryError ? (
        <Button variant="secondary" disabled={busy} onClick={() => { void retry(); }}>
          {busy ? 'Синхронизация…' : 'Повторить синхронизацию'}
        </Button>
      ) : null}
    </div>
  );
}
