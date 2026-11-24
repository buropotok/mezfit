import { useEffect, useRef, useState } from 'react';
import { ApiError, completeBrowserLogin, getBrowserSession, logoutBrowserSession, prepareBrowserLogin } from '../api';
import { BrowserDexieDiagnostic } from '../diagnostics/BrowserDexieDiagnostic';
import { Button, Surface, Text, TextArea } from '../ui';
import type { BrowserIdentity } from './browserSession';
import { loadTelegramLoginSdk } from './telegramLoginSdk';

type BrowserAuthState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'unavailable' }
  | { status: 'signed-in'; identity: BrowserIdentity };

type LoginAttempt =
  | { status: 'preparing' | 'active' | 'legacy' }
  | { status: 'ready'; expiresAt: number; open: () => void }
  | { status: 'error'; message: string };

/**
 * Browser OIDC identity does not grant Mini App initData. The verified browser
 * identity stays on this screen until the browser app bootstrap is wired up.
 */
export function BrowserTelegramLogin() {
  const [state, setState] = useState<BrowserAuthState>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState<LoginAttempt>({ status: 'preparing' });
  const [retry, setRetry] = useState(0);
  const [debugToken, setDebugToken] = useState<string | null>(null);
  const opening = useRef(false);
  const query = new URLSearchParams(window.location.search);
  const debugTokenEnabled = query.get('debugTelegramToken') === '1';
  const debugDexieEnabled = query.get('debugDexie') === '1';

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    void getBrowserSession(controller.signal).then(identity => {
      if (active) {
        setState(identity ? { status: 'signed-in', identity } : { status: 'signed-out' });
      }
    }).catch(() => {
      if (active) setState({ status: 'unavailable' });
    }).finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (state.status !== 'signed-out') return;
    const controller = new AbortController();
    let active = true;
    const startedAt = Date.now();
    let timer = window.setTimeout(() => controller.abort(), 8500);
    opening.current = false;
    setDebugToken(null);
    setAttempt({ status: 'preparing' });

    function fail(message: string) {
      if (active) setAttempt({ status: 'error', message });
    }

    void prepareBrowserLogin(controller.signal).then(async challenge => {
      window.clearTimeout(timer);
      if (!active) return;
      if (!challenge) {
        setAttempt({ status: 'legacy' });
        return;
      }
      const sdk = await loadTelegramLoginSdk();
      if (!active) return;
      setAttempt({ status: 'ready', expiresAt: startedAt + (challenge.expiresIn - 100) * 1000, open() {
        if (opening.current) return;
        opening.current = true;
        setAttempt({ status: 'active' });
        let pending = true;
        timer = window.setTimeout(() => {
          pending = false;
          fail('Telegram не ответил. Проверьте, разрешены ли всплывающие окна, и попробуйте ещё раз.');
        }, 90_000);
        try {
          sdk.auth({ client_id: challenge.clientId, scope: ['profile'], nonce: challenge.nonce, lang: 'ru' }, (payload) => {
            if (!active || !pending) return;
            pending = false;
            window.clearTimeout(timer);
            const token = payload && typeof payload === 'object' && !('error' in payload)
              && 'id_token' in payload && typeof payload.id_token === 'string' ? payload.id_token : null;
            if (!token) {
              fail('Telegram не завершил вход. Можно попробовать ещё раз.');
              return;
            }
            if (debugTokenEnabled) setDebugToken(token);
            timer = window.setTimeout(() => controller.abort(), 15_000);
            void completeBrowserLogin(token, controller.signal).then(identity => {
              if (active) setState({ status: 'signed-in', identity });
            }).catch(error => {
              fail(error instanceof ApiError ? error.message : 'Не удалось завершить вход. Попробуйте ещё раз.');
            }).finally(() => window.clearTimeout(timer));
          });
        } catch {
          pending = false;
          window.clearTimeout(timer);
          fail('Не удалось открыть окно Telegram. Попробуйте ещё раз.');
        }
      } });
    }).catch(error => {
      window.clearTimeout(timer);
      fail(error instanceof ApiError ? error.message : 'Не удалось подготовить вход через Telegram.');
    });

    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [state.status, retry, debugTokenEnabled]);

  async function signOut() {
    setDebugToken(null);
    setBusy(true);
    try {
      await logoutBrowserSession();
      setState({ status: 'signed-out' });
    } catch {
      // Preserve the server-confirmed account on a transient logout failure.
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="center">
      <Surface as="section">
        <div style={{ display: 'grid', gap: 16, padding: 20, width: 'min(86vw, 440px)' }}>
          <Text variant="caption">MEZFIT</Text>
          <Text variant="large-title">Авторизация через Telegram</Text>
          {state.status === 'loading' ? (
            <Text>Проверяем браузерную сессию…</Text>
          ) : state.status === 'signed-in' ? (
            <>
              <Text>Telegram подтвердил вашу личность: {state.identity.name || state.identity.username || state.identity.telegramUserId}.</Text>
              <Text variant="footnote" tone="muted">
                Браузерный вход подтверждён. Доступ к тренировкам и программам в браузере
                появится после подключения защищённых API.
                Пока используйте полную версию через @mezfit_bot.
              </Text>
              {debugDexieEnabled && (
                <BrowserDexieDiagnostic telegramUserId={state.identity.telegramUserId} disabled={busy} />
              )}
              <Button variant="secondary" onClick={() => void signOut()} disabled={busy}>
                Выйти
              </Button>
            </>
          ) : state.status === 'unavailable' ? (
            <>
              <Text>Откройте приложение в Telegram.</Text>
              <Text variant="footnote" tone="muted">
                Браузерная авторизация на этом адресе пока не подключена.
                Для работы Mini App откройте @mezfit_bot в Telegram.
              </Text>
            </>
          ) : (
            <>
              <Text>Подтвердите вход в Telegram, чтобы связать браузерную сессию с вашим аккаунтом.</Text>
              <Button disabled={attempt.status === 'preparing' || attempt.status === 'active'} onClick={() => {
                if (attempt.status === 'legacy') window.location.assign('/auth/start');
                else if (attempt.status === 'ready' && Date.now() < attempt.expiresAt) attempt.open();
                else setRetry(value => value + 1);
              }}>
                {attempt.status === 'error' ? 'Попробовать ещё раз' : 'Войти через Telegram'}
              </Button>
              {attempt.status === 'preparing' && <Text variant="footnote">Подготавливаем вход…</Text>}
              {attempt.status === 'active' && <Text variant="footnote">Завершите вход в окне Telegram.</Text>}
              {attempt.status === 'error' && <Text variant="footnote">{attempt.message}</Text>}
              <Text variant="footnote" tone="muted">
                Для полной работы приложения пока откройте @mezfit_bot в Telegram.
              </Text>
            </>
          )}
          {debugTokenEnabled && debugToken !== null && (
            <>
              <TextArea label="Полный токен Telegram" value={debugToken} readOnly rows={5} />
              <Text variant="footnote" tone="muted">
                Токен содержит данные аккаунта. Просматривайте его на своём устройстве.
              </Text>
              <Button variant="secondary" onClick={() => setDebugToken(null)}>Скрыть токен</Button>
            </>
          )}
        </div>
      </Surface>
    </main>
  );
}

