import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import {
  acceptCurrentInvite,
  addRole,
  getCurrentInvite,
  getMe,
  type ClientInvitePreview,
  type MeResponse,
  type Role,
} from './api';
import workoutFabIconUrl from './assets/strong.png';
import { ClientCoachProvider } from './client/ClientCoachContext';
import { ClientProgramsPage } from './client/ClientProgramsPage';
import { CoachShell } from './coach/CoachShell';
import {
  NavigationShell,
  type AppDestination,
  type NavigationContext,
} from './NavigationShell';
import { SettingsPage } from './settings/SettingsPage';
import { getTelegramWebApp, prepareTelegramWebApp } from './telegram';
import { Button, FloatingActionButton } from './ui';
import { WorkoutSessionScreen, type WorkoutSessionState } from './workout';

const ROLE_STORAGE_KEY = 'mezfit.activeRole';
const INVITE_START_PARAM_PATTERN = /^invite_[a-f0-9]{36}$/i;

function hasClientInviteStartParam(initData: string): boolean {
  const startParam = new URLSearchParams(initData).get('start_param');
  return startParam !== null && INVITE_START_PARAM_PATTERN.test(startParam);
}

type State =
  | { status: 'loading' }
  | { status: 'outside-telegram' }
  | { status: 'invite'; initData: string; me: MeResponse; invite: ClientInvitePreview }
  | { status: 'needs-role'; initData: string; me: MeResponse }
  | { status: 'ready'; initData: string; me: MeResponse; activeRole: Role; inviteAccepted: boolean }
  | { status: 'error'; message: string };

type Action =
  | { type: 'outside-telegram' }
  | { type: 'invite-found'; initData: string; me: MeResponse; invite: ClientInvitePreview }
  | { type: 'loaded'; initData: string; me: MeResponse; preferredRole?: Role; inviteAccepted?: boolean }
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
    case 'invite-found':
      return { status: 'invite', initData: action.initData, me: action.me, invite: action.invite };
    case 'loaded': {
      const activeRole = resolveActiveRole(action.me.roles, action.preferredRole);
      if (!activeRole) return { status: 'needs-role', initData: action.initData, me: action.me };
      return {
        status: 'ready',
        initData: action.initData,
        me: action.me,
        activeRole,
        inviteAccepted: action.inviteAccepted ?? false,
      };
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
  exercises: { title: 'Упражнения', text: 'Здесь будет доступ к упражнениям и истории результатов по ним.' },
  history: { title: 'История', text: 'Здесь появятся завершённые тренировки и фактические результаты.' },
  progress: { title: 'Прогресс', text: 'Здесь появятся замеры и производные показатели прогресса.' },
  settings: { title: 'Настройки', text: 'Настройки Mezfit будут добавляться по мере появления пользовательских параметров.' },
  about: { title: 'О приложении', text: 'Mezfit — рабочее пространство тренера и клиента внутри Telegram.' },
};

function InviteOnboarding({
  initData,
  invite,
  onAccepted,
}: {
  initData: string;
  invite: ClientInvitePreview;
  onAccepted: (roles: Role[]) => void;
}) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const coachName = [invite.coach.firstName, invite.coach.lastName].filter(Boolean).join(' ');

  const accept = async () => {
    setBusy(true);
    setMessage('');
    try {
      const result = await acceptCurrentInvite(initData);
      onAccepted(result.roles);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось принять приглашение');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="center">
      <section className="card">
        <div className="eyebrow">Приглашение</div>
        <h2>{coachName} приглашает вас в Mezfit</h2>
        {invite.label ? <p>{invite.label}</p> : <p>После подтверждения тренер сможет назначать вам программу и видеть результаты тренировок.</p>}
        <Button className="primary-button full-width" onClick={accept} disabled={busy}>{busy ? 'Подключаем…' : 'Подключиться к тренеру'}</Button>
        {message ? <p className="inline-message">{message}</p> : null}
      </section>
    </main>
  );
}

function ClientShell({
  initData,
  destination,
  inviteAccepted,
}: {
  initData: string;
  destination: AppDestination;
  inviteAccepted: boolean;
}) {
  if (destination === 'programs') return <ClientProgramsPage initData={initData} />;

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
      <h2>{inviteAccepted ? 'Готово' : 'Тренировка'}</h2>
      <p>{inviteAccepted ? 'Вы подключены к тренеру. Назначенная программа появится здесь.' : 'Здесь будет ваша назначенная тренировка.'}</p>
    </section>
  );
}

export function App() {
  const [state, dispatch] = useReducer(reducer, { status: 'loading' });
  const [coachDestination, setCoachDestination] = useState<AppDestination>('clients');
  const [clientDestination, setClientDestination] = useState<AppDestination>('today');
  const [navigationContext, setNavigationContext] = useState<NavigationContext | null>(null);
  const [workoutOpen, setWorkoutOpen] = useState(false);
  const [workoutStatus, setWorkoutStatus] = useState<WorkoutSessionState['status'] | null>(null);
  const [workoutNestedNavigationContext, setWorkoutNestedNavigationContext] = useState<NavigationContext | null>(null);

  const handleNavigationContextChange = useCallback((context: NavigationContext | null) => {
    setNavigationContext(context);
  }, []);
  const closeWorkout = useCallback(() => {
    setWorkoutOpen(false);
    setWorkoutNestedNavigationContext(null);
  }, []);
  const workoutRootNavigationContext = useMemo<NavigationContext>(() => ({
    title: 'Тренировка',
    onBack: closeWorkout,
  }), [closeWorkout]);

  useEffect(() => {
    const webApp = getTelegramWebApp();
    if (!webApp?.initData) {
      dispatch({ type: 'outside-telegram' });
      return;
    }

    prepareTelegramWebApp(webApp);

    const initData = webApp.initData;
    let cancelled = false;
    getMe(initData)
      .then(async (me) => {
        if (cancelled) return;

        if (hasClientInviteStartParam(initData)) {
          const { invite } = await getCurrentInvite(initData);
          if (cancelled) return;
          if (invite) {
            dispatch({ type: 'invite-found', initData, me, invite });
            return;
          }
        }

        dispatch({ type: 'loaded', initData, me });
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

  if (state.status === 'invite') {
    const accepted = (roles: Role[]) => {
      window.localStorage.setItem(ROLE_STORAGE_KEY, 'client');
      dispatch({
        type: 'loaded',
        initData: state.initData,
        me: { ...state.me, roles },
        preferredRole: 'client',
        inviteAccepted: true,
      });
    };

    return <InviteOnboarding initData={state.initData} invite={state.invite} onAccepted={accepted} />;
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
    setWorkoutOpen(false);
    setWorkoutNestedNavigationContext(null);
    setNavigationContext(null);
    if (state.activeRole === 'coach') setCoachDestination(next);
    else setClientDestination(next);
  };
  const switchRole = (role: Role) => {
    setWorkoutOpen(false);
    setWorkoutNestedNavigationContext(null);
    setNavigationContext(null);
    dispatch({ type: 'switch-role', role });
  };
  const shellContext = workoutOpen ? workoutNestedNavigationContext ?? workoutRootNavigationContext : navigationContext;
  const workoutFabLabel = workoutStatus === 'active' ? 'Продолжить тренировку' : 'Открыть тренировку';

  return (
    <ClientCoachProvider
      initData={state.initData}
      clientUserId={state.me.user.id}
      enabled={state.activeRole === 'client'}
    >
      <NavigationShell
        me={state.me}
        activeRole={state.activeRole}
        destination={destination}
        context={shellContext}
        onDestinationChange={changeDestination}
        onRoleSwitch={switchRole}
        floatingAction={(
          <FloatingActionButton
            placement="left"
            label={workoutFabLabel}
            isShown={!workoutOpen}
            onClick={() => setWorkoutOpen(true)}
          >
            <img
              src={workoutFabIconUrl}
              alt=""
              aria-hidden="true"
              style={{ display: 'block', width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover', pointerEvents: 'none' }}
            />
          </FloatingActionButton>
        )}
      >
        {workoutOpen ? (
          <WorkoutSessionScreen
            initData={state.initData}
            onClose={closeWorkout}
            onNavigationContextChange={setWorkoutNestedNavigationContext}
            onSessionLifecycleChange={({ status }) => setWorkoutStatus(status)}
          />
        ) : destination === 'settings' ? (
          <SettingsPage onNavigationContextChange={handleNavigationContextChange} />
        ) : state.activeRole === 'coach' ? (
          <CoachShell
            initData={state.initData}
            destination={coachDestination}
            onNavigationContextChange={handleNavigationContextChange}
          />
        ) : (
          <ClientShell
            initData={state.initData}
            destination={clientDestination}
            inviteAccepted={state.inviteAccepted}
          />
        )}
      </NavigationShell>
    </ClientCoachProvider>
  );
}
