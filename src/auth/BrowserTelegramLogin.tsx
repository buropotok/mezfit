import { useEffect, useState } from 'react';
import { getBrowserSession, logoutBrowserSession } from '../api';
import { Button, Surface, Text } from '../ui';
import type { BrowserIdentity } from './browserSession';

type BrowserAuthState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'unavailable' }
  | { status: 'signed-in'; identity: BrowserIdentity };

/**
 * Browser OIDC identity does not grant Mini App initData. The verified browser
 * identity stays at this explicitly limited boundary until protected API
 * endpoints and Dexie token exchange support that credential type server-side.
 */
export function BrowserTelegramLogin() {
  const [state, setState] = useState<BrowserAuthState>({ status: 'loading' });
  const [busy, setBusy] = useState(false);

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

  async function signOut() {
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
                Браузерный вход подтверждён. Доступ к тренировкам, программам и Dexie Cloud
                через этот вид сессии появится после переноса защищённого API на Яндекс.
                Пока используйте полную версию через @mezfit_bot.
              </Text>
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
              <Button onClick={() => window.location.assign('/auth/start')}>Войти через Telegram</Button>
              <Text variant="footnote" tone="muted">
                Для полной работы приложения пока откройте @mezfit_bot в Telegram.
              </Text>
            </>
          )}
        </div>
      </Surface>
    </main>
  );
}

