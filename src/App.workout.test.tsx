// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCurrentInvite, getCurrentWorkoutSession, getMe } from './api';
import { App } from './App';

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return {
    ...actual,
    getCurrentInvite: vi.fn(),
    getCurrentWorkoutSession: vi.fn(),
    getMe: vi.fn(),
  };
});

const local = vi.hoisted(() => ({ db: {}, rows: [] as { id: string; name: string; status: 'active' }[],
  fail: false, next: null as ((rows: { id: string; name: string; status: 'active' }[]) => void) | null }));
vi.mock('./data/cloud/client-workouts', () => ({ ClientWorkoutRepository: class {
  observeOpen(next: typeof local.next, error: (reason: unknown) => void) {
    local.next = next;
    if (local.fail) error(new Error('temporary local read failure'));
    else next?.(local.rows);
    return { unsubscribe: () => { local.next = null; } };
  }
} }));
vi.mock('./data/cloud/CloudConnectionsProvider', () => ({
  CloudConnectionsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useCloudConnections: () => ({ db: local.db,
    actorUserId: 'tg:100', clients: [], coaches: [], status: 'ready',
    error: '', refresh: vi.fn(async () => undefined),
  }),
}));

vi.mock('./exercises/PublicExerciseMediaPrefetch', () => ({ PublicExerciseMediaPrefetch: () => null }));
vi.mock('./workout/WorkedMuscleAssetsPrefetch', () => ({ WorkedMuscleAssetsPrefetch: () => null }));

vi.mock('./coach/CoachShell', () => ({
  CoachShell: () => <div>Coach home</div>,
}));

vi.mock('./workout/CoachAdHocWorkoutsScreen', () => ({
  CoachAdHocWorkoutsScreen: () => <div>Coach local workout</div>,
}));

vi.mock('./schedule/TodayPage', () => ({
  TodayPage: () => <div>Client home</div>,
}));

vi.mock('./workout/ClientSharedWorkoutScreen', () => ({
  ClientSharedWorkoutScreen: () => <div>Workout session<button onClick={() => {
    local.rows = [{ id: 'local-session', name: 'Workout', status: 'active' }];
    local.next?.(local.rows);
  }}>Mark workout active</button></div>,
}));

const getCurrentInviteMock = vi.mocked(getCurrentInvite);
const getCurrentWorkoutSessionMock = vi.mocked(getCurrentWorkoutSession);
const getMeMock = vi.mocked(getMe);

beforeEach(() => {
  local.rows = []; local.fail = false; local.next = null;
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  window.localStorage.clear();
  getCurrentInviteMock.mockReset();
  getCurrentWorkoutSessionMock.mockReset();
  getMeMock.mockReset();
  getCurrentInviteMock.mockResolvedValue({ invite: null });
  getCurrentWorkoutSessionMock.mockResolvedValue({ session: null });
  getMeMock.mockResolvedValue({
    user: {
      id: 10,
      telegramUserId: '100',
      username: null,
      firstName: 'Coach',
      lastName: null,
      languageCode: 'ru',
      photoUrl: null,
      isPremium: false,
    },
    roles: ['coach'],
  });
  window.Telegram = {
    WebApp: {
      initData: 'telegram-init',
      colorScheme: 'dark',
      ready: vi.fn(),
      expand: vi.fn(),
    },
  };
});

afterEach(() => {
  cleanup();
  delete window.Telegram;
  vi.unstubAllGlobals();
});

function getPrimaryTabsRoot(container: HTMLElement): ShadowRoot {
  const wrapper = container.querySelector<HTMLElement>('.navigation-primary-tabs > div');
  const host = wrapper?.firstElementChild;
  if (!(host instanceof HTMLElement) || !host.shadowRoot) {
    throw new Error('LiquidGlassIconOnly must expose its production shadow scene');
  }
  return host.shadowRoot;
}

describe('App workout navigation', () => {
  it('opens the real workout surface from the coach Training primary tab', async () => {
    const view = render(<App />);

    expect(await screen.findByText('Coach home')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Открыть тренировку' })).toBeNull();

    const trainingTab = getPrimaryTabsRoot(view.container)
      .querySelector<HTMLButtonElement>('[role="tab"][aria-label="Тренировка"]');
    if (!trainingTab) throw new Error('Missing coach Training tab');

    fireEvent.click(trainingTab);

    expect(await screen.findByText('Coach local workout')).toBeTruthy();
    expect(getCurrentWorkoutSessionMock).not.toHaveBeenCalled();
  });

  it('reads the existing local client workout after reload without REST before labeling the FAB', async () => {
    getMeMock.mockResolvedValue({
      user: {
        id: 10,
        telegramUserId: '100',
        username: null,
        firstName: 'Client',
        lastName: null,
        languageCode: 'ru',
        photoUrl: null,
        isPremium: false,
      },
      roles: ['client'],
    });
    local.rows = [{ id: 'local-session', name: 'Workout', status: 'active' }];

    render(<App />);

    expect(await screen.findByText('Client home')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Начать тренировку' })).toBeNull();
    expect(await screen.findByRole('button', { name: 'Продолжить тренировку' })).toBeTruthy();
    expect(getCurrentWorkoutSessionMock).not.toHaveBeenCalled();
  });

  it('keeps a recoverable workout entry when local observation fails', async () => {
    getMeMock.mockResolvedValue({
      user: {
        id: 10,
        telegramUserId: '100',
        username: null,
        firstName: 'Client',
        lastName: null,
        languageCode: 'ru',
        photoUrl: null,
        isPremium: false,
      },
      roles: ['client'],
    });
    local.fail = true;

    render(<App />);

    expect(await screen.findByText('Client home')).toBeTruthy();
    const fallback = await screen.findByRole('button', { name: 'Открыть тренировку' });
    expect(screen.queryByRole('button', { name: 'Начать тренировку' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Продолжить тренировку' })).toBeNull();

    fireEvent.click(fallback);

    expect(await screen.findByText('Workout session')).toBeTruthy();
  });

  it('keeps the client FAB as Continue after an active workout is left through primary navigation', async () => {
    getMeMock.mockResolvedValue({
      user: {
        id: 10,
        telegramUserId: '100',
        username: null,
        firstName: 'Client',
        lastName: null,
        languageCode: 'ru',
        photoUrl: null,
        isPremium: false,
      },
      roles: ['client'],
    });

    const view = render(<App />);
    expect(await screen.findByText('Client home')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Начать тренировку' })).toBeTruthy();

    const trainingTab = getPrimaryTabsRoot(view.container)
      .querySelector<HTMLButtonElement>('[role="tab"][aria-label="Тренировка"]');
    if (!trainingTab) throw new Error('Missing client Training tab');
    fireEvent.click(trainingTab);

    expect(await screen.findByText('Workout session')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mark workout active' }));

    const todayTab = getPrimaryTabsRoot(view.container)
      .querySelector<HTMLButtonElement>('[role="tab"][aria-label="Сегодня"]');
    if (!todayTab) throw new Error('Missing client Today tab');
    fireEvent.click(todayTab);

    expect(await screen.findByText('Client home')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Продолжить тренировку' })).toBeTruthy();
  });
});
