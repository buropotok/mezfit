import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  acceptCurrentInvite,
  addRole,
  getCurrentInvite,
  getCurrentWorkoutSession,
  getMe,
  type ClientInvitePreview,
  type MeResponse,
  type Role,
} from './api';
import { ClientCoachProvider, useClientCoach } from './client/ClientCoachContext';
import { ClientProgramsPage } from './client/ClientProgramsPage';
import { CoachShell } from './coach/CoachShell';
import { loadBrowserGlassSettings, saveBrowserGlassSettings } from './glassSettings';
import {
  NavigationShell,
  type AppDestination,
  type NavigationContext,
  type NavigationFloatingAction,
} from './NavigationShell';
import { SettingsPage } from './settings/SettingsPage';
import { TodayPage } from './schedule/TodayPage';
import { applyTypographySettings, loadBrowserTypographySettings, saveBrowserTypographySettings } from './typographySettings';
import { getTelegramLaunchStartParam, getTelegramWebApp, prepareTelegramWebApp } from './telegram';
import { Button, GlassSurfaceProvider } from './ui';
import { WorkoutSessionScreen, type WorkoutSessionState } from './workout';

const ROLE_STORAGE_KEY = 'mezfit.activeRole';

type State =
  | { status: 'loading' }
  | { status: 'outside-telegram' }
  | { status: 'needs-role'; initData: string; startParam: string | null; me: MeResponse }
  | { status: 'ready'; initData: string; startParam: string | null; me: MeResponse; activeRole: Role }
  | { status: 'error'; message: string };

type Action =
  | { type: 'outside-telegram' }
  | { type: 'loaded'; initData: string; startParam: string | null; me: MeResponse; preferredRole?: Role }
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
      if (!activeRole) return {
        status: 'needs-role',
        initData: action.initData,
        startParam: action.startParam,
        me: action.me,
      };
      return {
        status: 'ready',
        initData: action.initData,
        startParam: action.startParam,
        me: action.me,
        activeRole,
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
  analytics: { title: 'Аналитика', text: 'Здесь появятся аналитика тренировок, нагрузки и прогресса.' },
  exercises: { title: 'Упражнения', text: 'Здесь будет доступ к упражнениям и истории результатов по ним.' },
  history: { title: 'История', text: 'Здесь появятся завершённые тренировки и фактические результаты.' },
  progress: { title: 'Прогресс', text: 'Здесь появятся замеры и производные показатели прогресса.' },
  settings: { title: 'Настройки', text: 'Настройки Mezfit будут добавляться по мере появления пользовательских параметров.' },
  about: { title: 'О приложении', text: 'Mezfit — рабочее пространство тренера и клиента внутри Telegram.' },
};

function ClientShell({
  initData,
  currentUserId,
  startParam,
  destination,
  onNavigationContextChange,
}: {
  initData: string;
  currentUserId: number;
  startParam: string | null;
  destination: AppDestination;
  onNavigationContextChange: (context: NavigationContext | null) => void;
}) {
  const { refreshCoaches } = useClientCoach();
  const [invite, setInvite] = useState<ClientInvitePreview | null | undefined>(undefined);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getCurrentInvite(initData, startParam)
      .then((result) => {
        if (!cancelled) setInvite(result.invite);
      })
      .catch((error: unknown) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'Не удалось проверить приглашение');
      });
    return () => { cancelled = true; };
  }, [initData, startParam]);

  const accept = async () => {
    setBusy(true);
    setMessage('');
    try {
      await acceptCurrentInvite(initData, startParam);
      setInvite(null);
      refreshCoaches();
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

  if (destination === 'today') {
    return (
      <TodayPage
        initData={initData}
        role="client"
        currentUserId={currentUserId}
        onNavigationContextChange={onNavigationContextChange}
        notice={message}
      />
    );
  }

  if (destination === 'programs') return <ClientProgramsPage initData={initData} />;

  const placeholder = clientPlaceholderCopy[destination] ?? { title: 'Раздел', text: 'Этот раздел будет реализован отдельной задачей.' };
  return (
    <section className="global-placeholder">
      <h2>{placeholder.title}</h2>
      <p>{placeholder.text}</p>
    </section>
  );
}

export function App() {
  const [state, dispatch] = useReducer(reducer, { status: 'loading' });
  const [coachDestination, setCoachDestination] = useState<AppDestination>('today');
  const [clientDestination, setClientDestination] = useState<AppDestination>('today');
  const [coachSettingsReturnDestination, setCoachSettingsReturnDestination] = useState<AppDestination>('today');
  const [navigationContext, setNavigationContext] = useState<NavigationContext | null>(null);
  const [workoutStatus, setWorkoutStatus] = useState<WorkoutSessionState['status'] | null | undefined>(undefined);
  const workoutStatusVersionRef = useRef(0);
  const [glassSettings, setGlassSettings] = useState(loadBrowserGlassSettings);
  const [typographySettings, setTypographySettings] = useState(loadBrowserTypographySettings);

  const handleNavigationContextChange = useCallback((context: NavigationContext | null) => {
    setNavigationContext(context);
  }, []);
  const coachSettingsRootContext = useMemo<NavigationContext>(() => ({
    level: 2,
    title: 'Настройки',
    scrollKey: 'settings:root',
    identity: { title: 'Настройки', icon: 'settings' },
    onBack: () => {
      setNavigationContext(null);
      setCoachDestination(coachSettingsReturnDestination);
    },
  }), [coachSettingsReturnDestination]);

  useEffect(() => {
    saveBrowserGlassSettings(glassSettings);
  }, [glassSettings]);

  useEffect(() => {
    applyTypographySettings(typographySettings);
    saveBrowserTypographySettings(typographySettings);
  }, [typographySettings]);

  useEffect(() => {
    const webApp = getTelegramWebApp();
    if (!webApp?.initData) {
      dispatch({ type: 'outside-telegram' });
      return;
    }

    prepareTelegramWebApp(webApp);
    const startParam = getTelegramLaunchStartParam(webApp);

    let cancelled = false;
    getMe(webApp.initData)
      .then((me) => {
        if (!cancelled) dispatch({
          type: 'loaded',
          initData: webApp.initData,
          startParam,
          me,
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) dispatch({ type: 'error', message: error instanceof Error ? error.message : 'Не удалось загрузить профиль' });
      });

    return () => { cancelled = true; };
  }, []);

  const readyClientInitData = state.status === 'ready' && state.activeRole === 'client'
    ? state.initData
    : null;

  useEffect(() => {
    if (!readyClientInitData) return undefined;

    let cancelled = false;
    const requestVersion = workoutStatusVersionRef.current;
    setWorkoutStatus(undefined);

    getCurrentWorkoutSession(readyClientInitData)
      .then(({ session }) => {
        if (!cancelled && workoutStatusVersionRef.current === requestVersion) {
          setWorkoutStatus(session?.status ?? null);
        }
      })
      .catch(() => {
        if (!cancelled && workoutStatusVersionRef.current === requestVersion) {
          setWorkoutStatus(null);
        }
      });

    return () => { cancelled = true; };
  }, [readyClientInitData]);

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
        dispatch({
          type: 'loaded',
          initData: state.initData,
          startParam: state.startParam,
          me,
          preferredRole: role,
        });
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
    if (state.activeRole === 'coach') {
      if (next === 'settings' && coachDestination !== 'settings') {
        setCoachSettingsReturnDestination(coachDestination);
      }
      setCoachDestination(next);
    } else {
      setClientDestination(next);
    }
  };
  const switchRole = (role: Role) => {
    setNavigationContext(null);
    dispatch({ type: 'switch-role', role });
  };
  const shellContext = state.activeRole === 'coach' && destination === 'settings'
    ? navigationContext ?? coachSettingsRootContext
    : navigationContext;
  const clientWorkoutFloatingAction: NavigationFloatingAction | null = state.activeRole === 'client'
    ? {
        label: workoutStatus === 'active' ? 'Продолжить тренировку' : 'Начать тренировку',
        placement: 'left',
        isShown: destination !== 'training' && workoutStatus !== undefined,
        onClick: () => changeDestination('training'),
        icon: 'barbell',
      }
    : null;

  return (
    <GlassSurfaceProvider blur={glassSettings.blur} optics={glassSettings.optics}>
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
          floatingAction={clientWorkoutFloatingAction}
          glassPreset={glassSettings.preset}
          glassOptics={glassSettings.optics}
        >
          {destination === 'training' ? (
            <WorkoutSessionScreen
              initData={state.initData}
              onClose={() => changeDestination('today')}
              onNavigationContextChange={handleNavigationContextChange}
              onSessionLifecycleChange={({ status }) => {
                workoutStatusVersionRef.current += 1;
                setWorkoutStatus(status);
              }}
            />
          ) : destination === 'settings' ? (
          <SettingsPage
            glassSettings={glassSettings}
            onGlassSettingsChange={setGlassSettings}
            typographySettings={typographySettings}
            onTypographySettingsChange={setTypographySettings}
            onNavigationContextChange={handleNavigationContextChange}
          />
        ) : state.activeRole === 'coach' ? (
          <CoachShell
            initData={state.initData}
            destination={coachDestination}
            onNavigationContextChange={handleNavigationContextChange}
          />
        ) : (
          <ClientShell
            initData={state.initData}
            currentUserId={state.me.user.id}
            startParam={state.startParam}
            destination={clientDestination}
            onNavigationContextChange={handleNavigationContextChange}
          />
          )}
        </NavigationShell>
      </ClientCoachProvider>
    </GlassSurfaceProvider>
  );
}
