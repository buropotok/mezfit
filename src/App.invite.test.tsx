// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acceptCurrentInvite,
  getCurrentInvite,
  getMe,
} from './api';
import { App } from './App';

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return {
    ...actual,
    acceptCurrentInvite: vi.fn(),
    getCurrentInvite: vi.fn(),
    getMe: vi.fn(),
  };
});

vi.mock('./NavigationShell', () => ({
  NavigationShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('./schedule/TodayPage', () => ({
  TodayPage: () => <div>Client Today</div>,
}));

const acceptCurrentInviteMock = vi.mocked(acceptCurrentInvite);
const getCurrentInviteMock = vi.mocked(getCurrentInvite);
const getMeMock = vi.mocked(getMe);

const oldCoach = {
  relationshipId: 'rlm-old',
  user: {
    id: 'tg:200', telegramUserId: '200', username: null,
    firstName: 'Старый Тренер', lastName: null, photoUrl: null,
  },
};

const newCoach = {
  relationshipId: 'rlm-new',
  user: {
    id: 'tg:300', telegramUserId: '300', username: null,
    firstName: 'Новый Тренер', lastName: null, photoUrl: null,
  },
};

const cloudRefresh = vi.fn();

const TestCloudContext = createContext({
  actorUserId: 'tg:100',
  clients: [] as typeof oldCoach[],
  coaches: [] as typeof oldCoach[],
  status: 'ready' as const,
  error: '',
  refresh: async () => undefined,
});

function TestCloudProvider({ children }: { children: ReactNode }) {
  const [coaches, setCoaches] = useState([oldCoach]);
  const refresh = useCallback(async () => {
    cloudRefresh();
    setCoaches([oldCoach, newCoach]);
  }, []);
  return (
    <TestCloudContext.Provider value={{ actorUserId: 'tg:100', clients: [], coaches, status: 'ready', error: '', refresh }}>
      {children}
    </TestCloudContext.Provider>
  );
}

vi.mock('./data/cloud/CloudConnectionsProvider', () => ({
  CloudConnectionsProvider: ({ children }: { children: ReactNode }) => <TestCloudProvider>{children}</TestCloudProvider>,
  useCloudConnections: () => useContext(TestCloudContext),
}));

beforeEach(() => {
  window.localStorage.clear();
  cloudRefresh.mockClear();
  window.localStorage.setItem('mezfit.selectedCloudCoachUserId.100', String(oldCoach.user.id));
  window.history.replaceState({}, '', `/?tgWebAppStartParam=invite_${'b'.repeat(36)}`);

  getMeMock.mockReset();
  getCurrentInviteMock.mockReset();
  acceptCurrentInviteMock.mockReset();

  getMeMock.mockResolvedValue({
    user: {
      id: 10,
      telegramUserId: '100',
      username: 'client',
      firstName: 'Клиент',
      lastName: null,
      languageCode: 'ru',
      photoUrl: null,
      isPremium: false,
    },
    roles: ['client'],
  });
  getCurrentInviteMock.mockResolvedValue({
    invite: {
      label: null,
      expiresAt: '2026-10-22T00:00:00Z',
      coach: {
        firstName: newCoach.user.firstName,
        lastName: newCoach.user.lastName,
        username: newCoach.user.username,
      },
    },
  });
  acceptCurrentInviteMock.mockResolvedValue({ ok: true, roles: ['client'] });
  window.Telegram = {
    WebApp: {
      initData: 'telegram-init',
      initDataUnsafe: {
        start_param: `invite_${'a'.repeat(36)}`,
      },
      colorScheme: 'dark',
      ready: vi.fn(),
      expand: vi.fn(),
    },
  };
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
  delete window.Telegram;
});

describe('client invite launch', () => {
  it('adds a second coach using the current deep-link invite without changing the selected coach', async () => {
    render(<App />);

    expect(await screen.findByText('Новый Тренер приглашает вас в Mezfit')).toBeTruthy();
    expect(getCurrentInviteMock).toHaveBeenCalledWith(
      'telegram-init',
      `invite_${'b'.repeat(36)}`,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Подключиться к тренеру' }));

    await waitFor(() => {
      expect(acceptCurrentInviteMock).toHaveBeenCalledWith(
        'telegram-init',
        `invite_${'b'.repeat(36)}`,
      );
    });
    await waitFor(() => {
      expect(cloudRefresh).toHaveBeenCalledTimes(1);
    });

    expect(window.localStorage.getItem('mezfit.selectedCloudCoachUserId.100'))
      .toBe(String(oldCoach.user.id));
  });
});
