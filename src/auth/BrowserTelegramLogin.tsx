import { useEffect, useState } from 'react';
import { Button, Surface, Text } from '../ui';

interface BrowserIdentity {
  telegramUserId: string;
  name: string;
  username: string;
}

type BrowserAuthState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'unavailable' }
  | { status: 'signed-in'; identity: BrowserIdentity };

function parseBrowserSession(value: unknown): BrowserIdentity | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.authenticated !== true
      || typeof record.telegramUserId !== 'string'
      || !/^[1-9]\d{0,15}$/.test(record.telegramUserId)
      || typeof record.name !== 'string'
      || record.name.length > 120
      || typeof record.username !== 'string'
      || record.username.length > 64) return null;
  return {
    telegramUserId: record.telegramUserId,
    name: record.name,
    username: record.username,
  };
}

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
    void fetch('/auth/session', {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    }).then(async response => {
      if (response.status === 401) {
        if (active) setState({ status: 'signed-out' });
        return;
      }
      if (!response.ok) throw new Error('Browser login unavailable');
      const value: unknown = await response.json();
      const identity = parseBrowserSession(value);
      if (!identity) throw new Error('Invalid session response');
      if (active) setState({ status: 'signed-in', identity });
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
      const response = await fetch('/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Logout failed');
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

export { parseBrowserSession };
