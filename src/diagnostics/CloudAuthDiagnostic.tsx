import { useEffect, useRef, useState } from 'react';
import { Button } from 'konsta/react';
import { ApiError } from '../api';
import { getTelegramWebApp, prepareTelegramWebApp } from '../telegram';
import { Text } from '../ui';
import { runCloudAuthProbe } from './cloudAuthProbe';

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
        <h1><Text variant="title">Проверка Dexie Cloud</Text></h1>
        <Text variant="body">Проверим авторизацию Telegram через Worker. Данные тренировок не затрагиваются.</Text>
        <Button onClick={check} disabled={!webApp?.initData || status === 'pending'}>
          {status === 'pending' ? 'Проверяем…' : 'Проверить авторизацию'}
        </Button>
        <Text variant="body" role="status" aria-live="polite">
          {!webApp?.initData
            ? 'Запустите проверку внутри Telegram.'
            : status === 'success'
              ? 'Успешно: Dexie Cloud выдал токен для подтверждённого Telegram-пользователя.'
              : status === 'failed'
                ? `Ошибка проверки: ${errorCode}`
                : status === 'pending'
                  ? 'Запрашиваем токен…'
                  : 'Нажмите кнопку, чтобы начать проверку.'}
        </Text>
        <Text variant="footnote" tone="muted">Токены, ключи и Telegram initData не отображаются и не сохраняются.</Text>
      </section>
    </main>
  );
}
