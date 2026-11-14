import { parseNotificationStartParam } from '../shared/telegram-notification-link';
import { DiscussionsProvider } from './discussions/DiscussionsProvider';
import { DiscussionsPage } from './discussions/DiscussionsPage';
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useState, type ComponentProps } from 'react';
import {
  acceptCurrentInvite,
  ApiError,
  addRole,
  getCurrentInvite,
  getMe,
  dismissOpenedTelegramNotification,
  type ClientInvitePreview,
  type MeResponse,
  type Role,
} from './api';
import { ClientCoachProvider, useClientCoach } from './client/ClientCoachContext';
import { clearConfirmedAccount, matchesCurrentLaunch, readConfirmedAccount, saveConfirmedAccount } from './appSessionCache';
import { UserProfilePublicationProvider } from './profile/UserProfilePublicationProvider';
import { UserProfileNavigationShell } from './profile/UserProfileNavigationShell';
import { applyBackgroundSettings, loadBrowserBackgroundSettings, saveBrowserBackgroundSettings } from './backgroundSettings';
import { AssignedProgramsProvider } from './data/cloud/AssignedProgramsProvider';
import { CloudConnectionsProvider } from './data/cloud/CloudConnectionsProvider';
import { CLOUD_ASSIGNED_PROGRAMS_ENABLED } from './data/cloud/pilot-activation';
import type { ProgramActor } from './program/ProgramSummary';
import { ClientProgramsPage } from './client/ClientProgramsPage';
import { CoachShell } from './coach/CoachShell';
import { PersonalExercises } from './exercises/PersonalExercises';
import { PublicExerciseMediaPrefetch } from './exercises/PublicExerciseMediaPrefetch';
import { PublicCategoryArtworkProvider } from './exercises/PublicCategoryArtworkProvider';
import { loadBrowserGlassSettings, saveBrowserGlassSettings } from './glassSettings';
import { applyFontFamily, loadBrowserFontFamily, saveBrowserFontFamily } from './fontFamilySettings';
import {
  type AppDestination,
  type NavigationContext,
} from './NavigationShell';
import { avatarProfileDestination } from './navigation/AvatarProfileNavigation';
import { SettingsPage } from './settings/SettingsPage';
import { isScreenDiagnosticsStartParam } from './settings/screenDiagnosticsRoute';
import { TodayPage } from './schedule/TodayPage';
import { SchedulePlanningContext } from './schedule/SchedulePlanningContext';
import { applyTypographySettings, loadBrowserTypographySettings, saveBrowserTypographySettings } from './typographySettings';
import { HomeScreenInstallToast } from './homeScreen/HomeScreenInstallToast';
import { getTelegramLaunchStartParam, getTelegramWebApp, prepareTelegramWebApp } from './telegram';
import { ClientInviteEntry, isClientInviteStartParam } from './invite/ClientInviteEntry';
import { Button as KonstaButton } from 'konsta/react';
import { Button, GlassSurfaceProvider, Text } from './ui';
import { ClientWorkoutProvider } from './workout/ClientWorkoutContext';
import { PlannedWorkoutStartProvider } from './workout/PlannedWorkoutStartContext';
import { WorkoutCompletionProvider } from './workout/WorkoutCompletionContext';
import { CoachAdHocWorkoutsScreen } from './workout/CoachAdHocWorkoutsScreen';
import { ClientSharedWorkoutScreen } from './workout/ClientSharedWorkoutScreen';
import { WorkedMuscleAssetsPrefetch } from './workout/WorkedMuscleAssetsPrefetch';

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
  actor,
  startParam,
  destination,
  notificationMessageId,
  onNotificationOpened,
  onNavigationContextChange,
}: {
  initData: string;
  currentUserId: number;
  notificationMessageId?: string | null;
  onNotificationOpened: () => void;
  actor?: ProgramActor;
  startParam: string | null;
  destination: AppDestination;
  onNavigationContextChange: (context: NavigationContext | null) => void;
}) {
  const { refreshCoaches, selectedCoach } = useClientCoach();
  const [invite, setInvite] = useState<ClientInvitePreview | null | undefined>(undefined);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [inviteRetryKey, setInviteRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setInvite(undefined);
    setMessage('');
    getCurrentInvite(initData, startParam)
      .then((result) => {
        if (!cancelled) setInvite(result.invite);
      })
      .catch((error: unknown) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'Не удалось проверить приглашение');
      });
    return () => { cancelled = true; };
  }, [initData, startParam, inviteRetryKey]);

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

  if (invite === undefined && message && isClientInviteStartParam(startParam)) {
    return (
      <section className="card stack">
        <Text variant="headline">Не удалось проверить приглашение</Text>
        <Text variant="body" role="alert">{message}</Text>
        <KonstaButton rounded onClick={() => setInviteRetryKey((value) => value + 1)}>Повторить</KonstaButton>
      </section>
    );
  }

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
        actor={actor}
        initData={initData}
        role="client"
        currentUserId={currentUserId}
        onNavigationContextChange={onNavigationContextChange}
        notice={message}
      />
    );
  }

  if (destination === 'discussions') return <DiscussionsPage role="client" notificationMessageId={notificationMessageId}
    onNotificationOpened={onNotificationOpened} onNavigationContextChange={onNavigationContextChange} />;
  if (destination === 'programs') return (
    <ClientProgramsPage actor={actor} onNavigationContextChange={onNavigationContextChange} />
  );
  if (destination === 'exercises') return <PersonalExercises role="client"
    selectedCoachUserId={selectedCoach?.userId ?? null}
    onNavigationContextChange={onNavigationContextChange} />;

  const placeholder = clientPlaceholderCopy[destination] ?? { title: 'Раздел', text: 'Этот раздел будет реализован отдельной задачей.' };
  return (
    <section className="global-placeholder">
      <h2>{placeholder.title}</h2>
      <p>{placeholder.text}</p>
    </section>
  );
}

/** Navigation receives the selected coach from its owning client context. */
function ClientCoachAwareNavigationShell(props: ComponentProps<typeof UserProfileNavigationShell>) {
  const { selectedCoach } = useClientCoach();
  return <UserProfileNavigationShell {...props}
    selectedCoach={props.activeRole === 'client' ? selectedCoach : null} />;
}

export function App() {
  const [state, dispatch] = useReducer(reducer, { status: 'loading' });
  const [dismissedInviteParam, setDismissedInviteParam] = useState<string | null>(null);
  const [notificationOccurrenceId, setNotificationOccurrenceId] = useState<string | null>(null);
  const [notificationMessageId, setNotificationMessageId] = useState<string | null>(null);
  const clearNotificationMessage = useCallback(() => setNotificationMessageId(null), []);
  const [coachDestination, setCoachDestination] = useState<AppDestination>('today');
  const [clientDestination, setClientDestination] = useState<AppDestination>('today');
  const [initialScreenDiagnosticsOpen, setInitialScreenDiagnosticsOpen] = useState(false);
  const [previewWidth, setPreviewWidth] = useState<320 | null>(null);
  const [clientSettingsReturnDestination, setClientSettingsReturnDestination] = useState<AppDestination>('today');
  const [coachProfileReturnDestination, setCoachProfileReturnDestination] = useState<AppDestination>('today');
  const [coachSettingsReturnDestination, setCoachSettingsReturnDestination] = useState<AppDestination>('today');
  const [navigationContext, setNavigationContext] = useState<NavigationContext | null>(null);
  const [completionNavigation, setCompletionNavigation] = useState<NavigationContext | null>(null);
  const [scheduleViewResetKey, setScheduleViewResetKey] = useState(0);
  const [requestedScheduleClientId, setRequestedScheduleClientId] = useState<string | null>(null);
  const [requestedScheduleDraftId, setRequestedScheduleDraftId] = useState<string | null>(null);
  const [requestedAvatarClient, setRequestedAvatarClient] = useState<{ userId: string; requestId: number } | null>(null);
  const [glassSettings, setGlassSettings] = useState(loadBrowserGlassSettings);
  const [backgroundSettings, setBackgroundSettings] = useState(loadBrowserBackgroundSettings);
  const [typographySettings, setTypographySettings] = useState(loadBrowserTypographySettings);
  const [fontFamily, setFontFamily] = useState(loadBrowserFontFamily);

  const handleNavigationContextChange = useCallback((context: NavigationContext | null) => {
    setNavigationContext(context);
  }, []);
  const settingsRootContext = useMemo<NavigationContext>(() => ({
    level: 2,
    title: 'Настройки',
    scrollKey: 'settings:root',
    identity: { title: 'Настройки', icon: 'settings' },
    onBack: () => {
      setNavigationContext(null);
      if (state.status === 'ready' && state.activeRole === 'coach') setCoachDestination(coachSettingsReturnDestination);
      else setClientDestination(clientSettingsReturnDestination);
    },
  }), [state.status, state.status === 'ready' ? state.activeRole : null, coachSettingsReturnDestination, clientSettingsReturnDestination]);
  const coachProfileRootContext = useMemo<NavigationContext>(() => ({
    level: 2, title: 'Мой профиль', scrollKey: 'profile:self',
    onBack: () => { setNavigationContext(null); setCoachDestination(coachProfileReturnDestination); },
  }), [coachProfileReturnDestination]);

  useEffect(() => {
    saveBrowserGlassSettings(glassSettings);
  }, [glassSettings]);

  useEffect(() => {
    applyBackgroundSettings(backgroundSettings);
    saveBrowserBackgroundSettings(backgroundSettings);
  }, [backgroundSettings]);

  const isScheduleScreen = state.status === 'ready'
    && (state.activeRole === 'coach' ? coachDestination : clientDestination) === 'today';

  useLayoutEffect(() => {
    document.documentElement.dataset.appBackground = isScheduleScreen ? 'schedule' : 'custom';
    return () => { delete document.documentElement.dataset.appBackground; };
  }, [isScheduleScreen]);

  useEffect(() => {
    applyTypographySettings(typographySettings);
    saveBrowserTypographySettings(typographySettings);
  }, [typographySettings]);

  useEffect(() => {
    applyFontFamily(fontFamily);
    saveBrowserFontFamily(fontFamily);
  }, [fontFamily]);

  useEffect(() => {
    const webApp = getTelegramWebApp();
    if (!webApp?.initData) {
      dispatch({ type: 'outside-telegram' });
      return;
    }

    prepareTelegramWebApp(webApp);
    const startParam = getTelegramLaunchStartParam(webApp);

    const notification = parseNotificationStartParam(startParam);
    if (notification?.kind === 'discussion') {
      setNotificationMessageId(notification.id);
      setCoachDestination('discussions');
      setClientDestination('discussions');
    } else if (notification?.kind === 'workout') {
      setNotificationOccurrenceId(notification.id);
    }

    if (notification?.receipt) void dismissOpenedTelegramNotification(webApp.initData).catch(() => {
      // The notification link remains usable if the bot or network is unavailable.
    });

    let cancelled = false;
    if (isScreenDiagnosticsStartParam(startParam)) {
      setCoachDestination('settings');
      setClientDestination('settings');
      setInitialScreenDiagnosticsOpen(true);
    }
    // Previously Worker-confirmed account metadata opens the local Dexie
    // working set before this launch is reverified online.
    const confirmed = readConfirmedAccount(webApp.initData);
    if (confirmed) dispatch({ type: 'loaded', initData: webApp.initData, startParam, me: confirmed });
    getMe(webApp.initData)
      .then((me) => {
        if (cancelled) return;
        if (!matchesCurrentLaunch(webApp.initData, me)) {
          clearConfirmedAccount(webApp.initData);
          dispatch({ type: 'error', message: 'Некорректный ответ авторизации Telegram.' });
          return;
        }
        saveConfirmedAccount(webApp.initData, me);
        dispatch({ type: 'loaded', initData: webApp.initData, startParam, me });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          clearConfirmedAccount(webApp.initData);
          dispatch({ type: 'error', message: error.message });
        } else if (!confirmed) {
          dispatch({ type: 'error', message: error instanceof Error ? error.message : 'Не удалось загрузить профиль' });
        }
        // Transient transport failure: keep the confirmed local session readable.
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

  // A fresh invitation is a launch intent, not a consequence of the stored
  // Coach/Client navigation role. Show the consent action for either role or
  // for an account that has not selected a role yet.
  const inviteStartParam = (state.status === 'needs-role' || state.status === 'ready')
    && isClientInviteStartParam(state.startParam) ? state.startParam : null;
  if (inviteStartParam && inviteStartParam !== dismissedInviteParam
    && (state.status === 'needs-role' || state.activeRole !== 'client')) {
    const { initData, me } = state;
    return (
      <ClientInviteEntry
        initData={initData}
        startParam={inviteStartParam}
        onAccepted={(roles) => {
          window.localStorage.setItem(ROLE_STORAGE_KEY, 'client');
          setDismissedInviteParam(inviteStartParam);
          dispatch({
            type: 'loaded', initData, startParam: null,
            me: { ...me, roles }, preferredRole: 'client',
          });
        }}
        onDismiss={() => setDismissedInviteParam(inviteStartParam)}
      />
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
    if (next !== 'clients') setRequestedAvatarClient(null);
    if (next !== 'discussions') setNotificationMessageId(null);
    if (next !== 'today') setNotificationOccurrenceId(null);
    setCompletionNavigation(null);
    setNavigationContext(null);
    if (state.activeRole === 'coach') {
      // Reopening a parent must retain its original return target rather than
      // create mutual Profile <-> Settings links.
      if (next === 'settings' && coachDestination !== 'settings'
        && !(coachDestination === 'profile' && coachProfileReturnDestination === 'settings')) {
        setCoachSettingsReturnDestination(coachDestination);
      }
      if (next === 'profile' && coachDestination !== 'profile'
        && !(coachDestination === 'settings' && coachSettingsReturnDestination === 'profile')) {
        setCoachProfileReturnDestination(coachDestination);
      }
      setCoachDestination(next);
    } else {
      if (next === 'settings' && clientDestination !== 'settings') setClientSettingsReturnDestination(clientDestination);
      setClientDestination(next);
    }
  };
  const openAvatarProfile = (userId: string) => {
    if (avatarProfileDestination(state.activeRole, `tg:${state.me.user.telegramUserId}`, userId) === 'profile') {
      changeDestination('profile');
      return;
    }
    setRequestedAvatarClient(current => ({ userId, requestId: (current?.requestId ?? 0) + 1 }));
    changeDestination('clients');
  };
  const switchRole = (role: Role) => {
    setRequestedAvatarClient(null);
    setCompletionNavigation(null);
    setNavigationContext(null);
    setRequestedScheduleDraftId(null);
    setNotificationOccurrenceId(null);
    setNotificationMessageId(null);
    dispatch({ type: 'switch-role', role });
  };
  const shellContext = destination === 'settings'
    ? navigationContext ?? settingsRootContext
    : state.activeRole === 'coach' && destination === 'profile'
      ? coachProfileRootContext : navigationContext;

  return (
    <GlassSurfaceProvider blur={glassSettings.blur} optics={glassSettings.optics}>
      <HomeScreenInstallToast />
      <CloudConnectionsProvider
        key={state.me.user.telegramUserId}
        telegramUserId={state.me.user.telegramUserId}
        initData={state.initData}
      >
      <UserProfilePublicationProvider>
      <PublicCategoryArtworkProvider>
      <ClientWorkoutProvider enabled={state.activeRole === 'client'}>
      <PublicExerciseMediaPrefetch />
      <WorkedMuscleAssetsPrefetch />
      <ClientCoachProvider
        clientTelegramUserId={state.me.user.telegramUserId}
        enabled={state.activeRole === 'client'}
      >
        <AssignedProgramsProvider
          key={state.me.user.telegramUserId}
          telegramUserId={state.me.user.telegramUserId}
          initData={state.initData}
          enabled={CLOUD_ASSIGNED_PROGRAMS_ENABLED && destination === 'programs'}
        >
        <SchedulePlanningContext.Provider value={{
          requestedDraftId: requestedScheduleDraftId,
          notificationOccurrenceId: state.activeRole === 'coach' ? notificationOccurrenceId : null,
          clearNotificationOccurrence: () => setNotificationOccurrenceId(null),
          requestedClientUserId: requestedScheduleClientId,
          viewResetKey: scheduleViewResetKey,
          openDraft: (id, clientUserId = null) => { setRequestedScheduleClientId(clientUserId); setRequestedScheduleDraftId(id); changeDestination('today'); },
          clearDraft: () => setRequestedScheduleDraftId(null),
        }}>
        <PlannedWorkoutStartProvider role={state.activeRole} enabled={destination === 'today' || destination === 'training'} onStarted={() => { setRequestedScheduleDraftId(null); changeDestination('training'); }}>
        <WorkoutCompletionProvider enabled={state.activeRole === 'coach' && (destination === 'today' || destination === 'training')}
          scope={state.activeRole + ':' + destination} onNavigationContextChange={setCompletionNavigation}>
        <DiscussionsProvider key={state.activeRole + state.me.user.telegramUserId} role={state.activeRole}
          details={destination === 'discussions' || destination === 'clients'}>
        <ClientCoachAwareNavigationShell
          initData={state.initData}
          me={state.me}
          activeRole={state.activeRole}
          suppressInitialProfileOpen={state.activeRole === 'client' && isClientInviteStartParam(state.startParam)}
          destination={destination}
          context={completionNavigation ?? shellContext}
          onDestinationChange={next => { if (next === 'today') setScheduleViewResetKey(value => value + 1); changeDestination(next); }}
          onRoleSwitch={switchRole}
          onAvatarProfileNavigate={openAvatarProfile}
          glassPreset={glassSettings.preset}
          glassOptics={glassSettings.optics}
          previewWidth={previewWidth}
        >
          {destination === 'training' && state.activeRole === 'coach' ? (
            <CoachAdHocWorkoutsScreen initData={state.initData}
              actor={{ name: [state.me.user.firstName, state.me.user.lastName].filter(Boolean).join(' '), photoUrl: state.me.user.photoUrl }}
              onNavigationContextChange={handleNavigationContextChange} />
          ) : destination === 'training' ? (
            <ClientSharedWorkoutScreen initData={state.initData}
              actor={{ name: [state.me.user.firstName, state.me.user.lastName].filter(Boolean).join(' '), photoUrl: state.me.user.photoUrl }}
              onNavigationContextChange={handleNavigationContextChange} />
          ) : destination === 'settings' ? (
          <SettingsPage
            activeRole={state.activeRole}
            backgroundSettings={backgroundSettings}
            onBackgroundSettingsChange={setBackgroundSettings}
            glassSettings={glassSettings}
            onGlassSettingsChange={setGlassSettings}
            typographySettings={typographySettings}
            onTypographySettingsChange={setTypographySettings}
            fontFamily={fontFamily}
            onFontFamilyChange={setFontFamily}
            onNavigationContextChange={handleNavigationContextChange}
            initialScreenDiagnosticsOpen={initialScreenDiagnosticsOpen}
            onScreenDiagnosticsDeepLinkConsumed={() => setInitialScreenDiagnosticsOpen(false)}
            previewWidth={previewWidth}
            onPreviewWidthChange={setPreviewWidth}
          />
        ) : state.activeRole === 'coach' ? (
          <CoachShell
            actor={{ name: [state.me.user.firstName, state.me.user.lastName].filter(Boolean).join(' '), photoUrl: state.me.user.photoUrl }}
            initData={state.initData}
            destination={coachDestination}
            requestedAvatarClient={requestedAvatarClient}
            notificationMessageId={notificationMessageId}
            onNotificationOpened={clearNotificationMessage}
            onNavigationContextChange={handleNavigationContextChange}
          />
        ) : (
          <ClientShell
            initData={state.initData}
            currentUserId={state.me.user.id}
            actor={{ name: [state.me.user.firstName, state.me.user.lastName].filter(Boolean).join(' '), photoUrl: state.me.user.photoUrl }}
            startParam={isScreenDiagnosticsStartParam(state.startParam) ? null : state.startParam}
            destination={clientDestination}
            notificationMessageId={notificationMessageId}
            onNotificationOpened={clearNotificationMessage}
            onNavigationContextChange={handleNavigationContextChange}
          />
          )}
        </ClientCoachAwareNavigationShell>
        </DiscussionsProvider>
        </WorkoutCompletionProvider>
        </PlannedWorkoutStartProvider>
        </SchedulePlanningContext.Provider>
        </AssignedProgramsProvider>
      </ClientCoachProvider>
      </ClientWorkoutProvider>
      </PublicCategoryArtworkProvider>
      </UserProfilePublicationProvider>
      </CloudConnectionsProvider>
    </GlassSurfaceProvider>
  );
}
