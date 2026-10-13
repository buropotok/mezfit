import { useEffect, useRef, useState } from 'react';
import { Button } from 'konsta/react';
import { ApiError } from '../api';
import { getTelegramWebApp, prepareTelegramWebApp } from '../telegram';
import { Text } from '../ui';
import { runCloudAuthProbe } from './cloudAuthProbe';
import { CloudSyncDiagnostic } from './CloudSyncDiagnostic';
import { CloudAvatarDiagnostic } from './CloudAvatarDiagnostic';

type ProbeStatus = 'idle' | 'pending' | 'success' | 'failed';

function safeErrorCode(error: unknown): string {
  if (error instanceof ApiError) return `${error.code ?? 'HTTP_ERROR'} (${error.status})`;
  if (error instanceof Error && error.message === 'CRYPTO_UNAVAILABLE') return 'CRYPTO_UNAVAILABLE';
  return 'CLIENT_ERROR';
}

/** Deliberately isolated from Coach/Client navigation and local storage. */
export function CloudAuthDiagnostic() {
  const webApp = getTelegramWebApp();
  const [status, setStatus] = useState<ProbeStatus>('idle');
  const [showSync, setShowSync] = useState(false);
  const [showAvatars, setShowAvatars] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    if (webApp) prepareTelegramWebApp(webApp);
    return () => { mountedRef.current = false; };
  }, [webApp]);

  const check = async () => {
    if (!webApp?.initData || pendingRef.current) return;
    pendingRef.current = true;
    setStatus('pending');
    setErrorCode(null);
    try {
      await runCloudAuthProbe(webApp.initData);
      if (mountedRef.current) setStatus('success');
    } catch (error: unknown) {
      if (mountedRef.current) {
        setErrorCode(safeErrorCode(error));
        setStatus('failed');
      }
    } finally {
      pendingRef.current = false;
    }
  };

  return (
    <main className="center">
      <section className="card">
        <h1><Text variant="large-title">Проверка Dexie Cloud</Text></h1>
        <p><Text variant="body">Проверим авторизацию Telegram через Worker. Данные тренировок не затрагиваются.</Text></p>
        <Button onClick={check} disabled={!webApp?.initData || status === 'pending'}>
          {status === 'pending' ? 'Проверяем…' : 'Проверить авторизацию'}
        </Button>
        <p role="status" aria-live="polite"><Text variant="body">
          {!webApp?.initData
            ? 'Запустите проверку внутри Telegram.'
            : status === 'success'
              ? 'Успешно: Dexie Cloud выдал токен для подтверждённого Telegram-пользователя.'
              : status === 'failed'
                ? `Ошибка проверки: ${errorCode}`
                : status === 'pending'
                  ? 'Запрашиваем токен…'
                  : 'Нажмите кнопку, чтобы начать проверку.'}
        </Text></p>
        <p><Text variant="footnote" tone="muted">Токены, ключи и Telegram initData не отображаются и не сохраняются.</Text></p>
        <Button onClick={() => { setShowSync((value) => !value); setShowAvatars(false); }} disabled={!webApp?.initData}>
          {showSync ? 'Скрыть диагностику синхронизации' : 'Проверить синхронизацию'}
        </Button>
        {showSync && webApp?.initData ? <CloudSyncDiagnostic initData={webApp.initData} /> : null}
        <Button onClick={() => { setShowAvatars((value) => !value); setShowSync(false); }} disabled={!webApp?.initData}>
          {showAvatars ? 'Скрыть диагностику аватаров' : 'Проверить аватары'}
        </Button>
        {showAvatars && webApp?.initData ? <CloudAvatarDiagnostic initData={webApp.initData} /> : null}
      </section>
    </main>
  );
}
