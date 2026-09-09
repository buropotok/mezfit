import { useEffect, useReducer, useState } from 'react';
import {
  acceptCurrentInvite,
  addRole,
  createClientInvite,
  getCoachClients,
  getCurrentInvite,
  getMe,
  type ClientInvitePreview,
  type CoachClientListItem,
  type MeResponse,
  type Role,
} from './api';
import { getTelegramWebApp } from './telegram';

const ROLE_STORAGE_KEY = 'mezfit.activeRole';

type State =
  | { status: 'loading' }
  | { status: 'outside-telegram' }
  | { status: 'needs-role'; initData: string; me: MeResponse }
  | { status: 'ready'; initData: string; me: MeResponse; activeRole: Role }
  | { status: 'error'; message: string };

type Action =
  | { type: 'outside-telegram' }
  | { type: 'loaded'; initData: string; me: MeResponse; preferredRole?: Role }
  | { type: 'switch-role'; role: Role }
  | { type: 'error'; message: string };

function resolveActiveRole(roles: Role[], preferredRole?: Role): Role | null {
  if (preferredRole && roles.includes(preferredRole)) return preferredRole;
  const stored = window.localStorage.getItem(ROLE_STORAGE_KEY);
  if ((stored === 'coach' || stored === 'client') && roles.includes(stored)) return stored;
  return roles[0] ?? null;
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'outside-telegram':
      return { status: 'outside-telegram' };
    case 'loaded': {
      const activeRole = resolveActiveRole(action.me.roles, action.preferredRole);
      if (!activeRole) return { status: 'needs-role', initData: action.initData, me: action.me };
      return { status: 'ready', initData: action.initData, me: action.me, activeRole };
    }
    case 'switch-role':
      if (state.status !== 'ready' || !state.me.roles.includes(action.role)) return state;
      window.localStorage.setItem(ROLE_STORAGE_KEY, action.role);
      return { ...state, activeRole: action.role };
    case 'error':
      return { status: 'error', message: action.message };
  }
}

function displayName(user: { firstName: string; lastName: string | null }): string {
  return [user.firstName, user.lastName].filter(Boolean).join(' ');
}

function ShellHeader({ me, activeRole, onSwitch }: { me: MeResponse; activeRole: Role; onSwitch: (role: Role) => void }) {
  return (
    <header className="shell-header">
      <div>
        <div className="eyebrow">Mezfit</div>
        <h1>{me.user.firstName}</h1>
      </div>
      {me.roles.length > 1 ? (
        <div className="role-switch" aria-label="Режим приложения">
          {me.roles.map((role) => (
            <button key={role} className={role === activeRole ? 'active' : ''} onClick={() => onSwitch(role)}>
              {role === 'coach' ? 'Тренер' : 'Клиент'}
            </button>
          ))}
        </div>
      ) : null}
    </header>
  );
}

function CoachShell({ initData }: { initData: string }) {
  const [clients, setClients] = useState<CoachClientListItem[] | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const refreshClients = () => {
    getCoachClients(initData)
      .then(({ clients: next }) => setClients(next))
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Не удалось загрузить клиентов'));
  };

  useEffect(refreshClients, [initData]);

  const createInvite = async () => {
    setBusy(true);
    setMessage('');
    try {
      const result = await createClientInvite(initData);
      setInviteUrl(result.telegramUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось создать приглашение');
    } finally {
      setBusy(false);
    }
  };

  const copyInvite = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setMessage('Ссылка скопирована');
    } catch {
      setMessage('Не удалось скопировать автоматически — нажмите и удерживайте ссылку');
    }
  };

  return (
    <section className="stack">
      <section className="card">
        <div className="section-heading">
          <div>
            <div className="eyebrow">Coach mode</div>
            <h2>Клиенты</h2>
          </div>
          <button className="primary-button" onClick={createInvite} disabled={busy}>{busy ? 'Создаём…' : '+ Клиент'}</button>
        </div>

        {clients === null ? <p>Загружаем клиентов…</p> : clients.length === 0 ? (
          <div className="empty-state">
            <strong>Пока нет клиентов</strong>
            <p>Создайте персональную ссылку и отправьте её клиенту в Telegram.</p>
          </div>
        ) : (
          <div className="client-list">
            {clients.map(({ relationshipId, user }) => (
              <button className="client-row" key={relationshipId} type="button">
                <span className="avatar">{user.firstName.slice(0, 1).toUpperCase()}</span>
                <span><strong>{displayName(user)}</strong><small>{user.username ? `@${user.username}` : 'Клиент Mezfit'}</small></span>
                <span aria-hidden="true">›</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {inviteUrl ? (
        <section className="card invite-card">
          <div className="eyebrow">Приглашение</div>
          <h2>Отправьте ссылку клиенту</h2>
          <p>Ссылка одноразовая и действует 30 дней. После подтверждения клиент автоматически появится в вашем списке.</p>
          <div className="link-box">{inviteUrl}</div>
          <div className="button-row">
            <button className="primary-button" onClick={copyInvite}>Копировать</button>
            <button className="secondary-button" onClick={() => setInviteUrl(null)}>Закрыть</button>
          </div>
        </section>
      ) : null}

      {message ? <p className="inline-message">{message}</p> : null}
    </section>
  );
}

function ClientShell({ initData }: { initData: string }) {
  const [invite, setInvite] = useState<ClientInvitePreview | null | undefined>(undefined);
  const [accepted, setAccepted] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getCurrentInvite(initData)
      .then((result) => setInvite(result.invite))
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Не удалось проверить приглашение'));
  }, [initData]);

  const accept = async () => {
    setBusy(true);
    setMessage('');
    try {
      await acceptCurrentInvite(initData);
      setAccepted(true);
      setInvite(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось принять приглашение');
    } finally {
      setBusy(false);
    }
  };

  if (invite) {
    const coachName = [invite.coach.firstName, invite.coach.lastName].filter(Boolean).join(' ');
    return (
      <section className="card">
        <div className="eyebrow">Приглашение</div>
        <h2>{coachName} приглашает вас в Mezfit</h2>
        {invite.label ? <p>{invite.label}</p> : <p>После подтверждения тренер сможет назначать вам программу и видеть результаты тренировок.</p>}
        <button className="primary-button full-width" onClick={accept} disabled={busy}>{busy ? 'Подключаем…' : 'Подключиться к тренеру'}</button>
        {message ? <p className="inline-message">{message}</p> : null}
      </section>
    );
  }

  return (
    <section className="card">
      <div className="eyebrow">Client mode</div>
      <h2>{accepted ? 'Готово' : 'Сегодня'}</h2>
      <p>{accepted ? 'Вы подключены к тренеру. Назначенная программа появится здесь.' : invite === undefined ? 'Проверяем приглашение…' : 'Здесь будет ваша назначенная тренировка.'}</p>
      {message ? <p className="inline-message">{message}</p> : null}
    </section>
  );
}

export function App() {
  const [state, dispatch] = useReducer(reducer, { status: 'loading' });

  useEffect(() => {
    const webApp = getTelegramWebApp();
    if (!webApp?.initData) {
      dispatch({ type: 'outside-telegram' });
      return;
    }

    webApp.ready();
    webApp.expand();

    let cancelled = false;
    getMe(webApp.initData)
      .then((me) => {
        if (!cancelled) dispatch({ type: 'loaded', initData: webApp.initData, me });
      })
      .catch((error: unknown) => {
        if (!cancelled) dispatch({ type: 'error', message: error instanceof Error ? error.message : 'Не удалось загрузить профиль' });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === 'loading') return <main className="center"><p>Подключаем Mezfit…</p></main>;

  if (state.status === 'outside-telegram') {
    return (
      <main className="center">
        <section className="card">
          <div className="eyebrow">Mezfit</div>
          <h1>Откройте приложение в Telegram</h1>
          <p>Mini App использует Telegram initData для безопасной авторизации. Откройте @mezfit_bot и запустите Mezfit оттуда.</p>
        </section>
      </main>
    );
  }

  if (state.status === 'error') {
    return (
      <main className="center">
        <section className="card error-card">
          <div className="eyebrow">Ошибка</div>
          <h1>Не удалось открыть Mezfit</h1>
          <p>{state.message}</p>
          <button onClick={() => window.location.reload()}>Обновить</button>
        </section>
      </main>
    );
  }

  if (state.status === 'needs-role') {
    const choose = async (role: Role) => {
      try {
        const me = await addRole(state.initData, role);
        window.localStorage.setItem(ROLE_STORAGE_KEY, role);
        dispatch({ type: 'loaded', initData: state.initData, me, preferredRole: role });
      } catch (error) {
        dispatch({ type: 'error', message: error instanceof Error ? error.message : 'Не удалось сохранить режим' });
      }
    };

    return (
      <main className="center">
        <section className="card">
          <div className="eyebrow">Первый запуск</div>
          <h1>Как вы будете использовать Mezfit?</h1>
          <p>Режим определяет стартовый интерфейс. Данные и авторизация остаются общими.</p>
          <div className="choice-grid">
            <button className="choice" onClick={() => choose('coach')}><strong>Я тренер</strong><span>Веду клиентов и программы</span></button>
            <button className="choice" onClick={() => choose('client')}><strong>Я клиент</strong><span>Выполняю назначенную программу</span></button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <ShellHeader me={state.me} activeRole={state.activeRole} onSwitch={(role) => dispatch({ type: 'switch-role', role })} />
      {state.activeRole === 'coach' ? <CoachShell initData={state.initData} /> : <ClientShell initData={state.initData} />}
    </main>
  );
}
