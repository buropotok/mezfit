import { useCallback, useEffect, useReducer, useState } from 'react';
import {
  acceptCurrentInvite,
  addRole,
  getCurrentInvite,
  getMe,
  type ClientInvitePreview,
  type MeResponse,
  type Role,
} from './api';
import { CoachShell } from './coach/CoachShell';
import {
  NavigationShell,
  type AppDestination,
  type NavigationContext,
} from './NavigationShell';
import { getTelegramWebApp } from './telegram';
import { Button } from './ui';

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

const clientPlaceholderCopy: Partial<Record<AppDestination, { title: string; text: string }>> = {
  programs: { title: 'Программа', text: 'Здесь будет назначенная тренером программа.' },
  exercises: { title: 'Упражнения', text: 'Здесь будет доступ к упражнениям и истории результатов по ним.' },
  history: { title: 'История', text: 'Здесь появятся завершённые тренировки и фактические результаты.' },
  progress: { title: 'Прогресс', text: 'Здесь появятся замеры и производные показатели прогресса.' },
  settings: { title: 'Настройки', text: 'Настройки Mezfit будут добавляться по мере появления пользовательских параметров.' },
  about: { title: 'О приложении', text: 'Mezfit — рабочее пространство тренера и клиента внутри Telegram.' },
};

function ClientShell({ initData, destination }: { initData: string; destination: AppDestination }) {
  const [invite, setInvite] = useState<ClientInvitePreview | null | undefined>(undefined);
  const [accepted, setAccepted] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getCurrentInvite(initData)
      .then((result) => {
        if (!cancelled) setInvite(result.invite);
      })
      .catch((error: unknown) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'Не удалось проверить приглашение');
      });
    return () => { cancelled = true; };
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
        <Button className="primary-button full-width" onClick={accept} disabled={busy}>{busy ? 'Подключаем…' : 'Подключиться к тренеру'}</Button>
        {message ? <p className="inline-message">{message}</p> : null}
      </section>
    );
  }

  if (destination !== 'today') {
    const placeholder = clientPlaceholderCopy[destination] ?? { title: 'Раздел', text: 'Этот раздел будет реализован отдельной задачей.' };
    return (
      <section className="global-placeholder">
        <h2>{placeholder.title}</h2>
        <p>{placeholder.text}</p>
      </section>
    );
  }

  return (
    <section className="card">
      <div className="eyebrow">Сегодня</div>
      <h2>{accepted ? 'Готово' : 'Тренировка'}</h2>
      <p>{accepted ? 'Вы подключены к тренеру. Назначенная программа появится здесь.' : invite === undefined ? 'Проверяем приглашение…' : 'Здесь будет ваша назначенная тренировка.'}</p>
      {message ? <p className="inline-message">{message}</p> : null}
    </section>
  );
}

export function App() {
  const [state, dispatch] = useReducer(reducer, { status: 'loading' });
  const [coachDestination, setCoachDestination] = useState<AppDestination>('clients');
  const [clientDestination, setClientDestination] = useState<AppDestination>('today');
  const [navigationContext, setNavigationContext] = useState<NavigationContext | null>(null);

  const handleNavigationContextChange = useCallback((context: NavigationContext | null) => {
    setNavigationContext(context);
  }, []);

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

    return () => { cancelled = true; };
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
          <Button onClick={() => window.location.reload()}>Обновить</Button>
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

  const destination = state.activeRole === 'coach' ? coachDestination : clientDestination;
  const changeDestination = (next: AppDestination) => {
    setNavigationContext(null);
    if (state.activeRole === 'coach') setCoachDestination(next);
    else setClientDestination(next);
  };
  const switchRole = (role: Role) => {
    setNavigationContext(null);
    dispatch({ type: 'switch-role', role });
  };

  return (
    <NavigationShell
      me={state.me}
      activeRole={state.activeRole}
      destination={destination}
      context={navigationContext}
      onDestinationChange={changeDestination}
      onRoleSwitch={switchRole}
    >
      {state.activeRole === 'coach' ? (
        <CoachShell
          initData={state.initData}
          destination={coachDestination}
          onNavigationContextChange={handleNavigationContextChange}
        />
      ) : (
        <ClientShell initData={state.initData} destination={clientDestination} />
      )}
    </NavigationShell>
  );
}
