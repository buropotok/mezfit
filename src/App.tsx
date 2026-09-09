import { useEffect, useReducer } from 'react';
import { addRole, getMe, type MeResponse, type Role } from './api';
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

function CoachShell({ me }: { me: MeResponse }) {
  return (
    <section className="card">
      <div className="eyebrow">Coach mode</div>
      <h2>Клиенты</h2>
      <p>Telegram-аутентификация и общий backend подключены. Следующий срез — список клиентов и выбранный клиент.</p>
      <div className="status-row"><span>Backend</span><strong>подключён</strong></div>
      <div className="status-row"><span>Telegram ID</span><strong>{me.user.telegramUserId}</strong></div>
    </section>
  );
}

function ClientShell({ me }: { me: MeResponse }) {
  return (
    <section className="card">
      <div className="eyebrow">Client mode</div>
      <h2>Сегодня</h2>
      <p>Telegram-аутентификация и общий backend подключены. Следующий срез — назначенная тренировка и запись результатов.</p>
      <div className="status-row"><span>Backend</span><strong>подключён</strong></div>
      <div className="status-row"><span>Telegram ID</span><strong>{me.user.telegramUserId}</strong></div>
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
      {state.activeRole === 'coach' ? <CoachShell me={state.me} /> : <ClientShell me={state.me} />}
    </main>
  );
}
