// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return {
    ...actual,
    acceptCurrentInvite: vi.fn(),
    addRole: vi.fn(),
    getCurrentInvite: vi.fn(),
    getMe: vi.fn(),
  };
});

vi.mock('./telegram', () => ({
  getTelegramWebApp: vi.fn(),
  prepareTelegramWebApp: vi.fn(),
}));

vi.mock('./client/ClientCoachContext', () => ({
  ClientCoachProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('./client/ClientProgramsPage', () => ({
  ClientProgramsPage: () => <div>client-programs</div>,
}));

vi.mock('./coach/CoachShell', () => ({
  CoachShell: () => <div>coach-shell</div>,
}));

vi.mock('./NavigationShell', () => ({
  NavigationShell: ({ children, activeRole }: { children: ReactNode; activeRole: string }) => (
    <div data-testid="navigation-shell" data-role={activeRole}>{children}</div>
  ),
}));

vi.mock('./settings/SettingsPage', () => ({
  SettingsPage: () => <div>settings-page</div>,
}));

vi.mock('./workout', () => ({
  WorkoutSessionScreen: () => <div>workout-session</div>,
}));

vi.mock('./ui', () => ({
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  FloatingActionButton: () => null,
}));

import {
  acceptCurrentInvite,
  getCurrentInvite,
  getMe,
  type ClientInvitePreview,
  type MeResponse,
} from './api';
import { App } from './App';
import { getTelegramWebApp } from './telegram';

const invite: ClientInvitePreview = {
  label: null,
  expiresAt: '2026-10-21T00:00:00Z',
  coach: {
    firstName: 'Анна',
    lastName: 'Иванова',
    username: 'anna',
  },
};

const dualRoleMe: MeResponse = {
  user: {
    id: 7,
    telegramUserId: '100500',
    username: 'test-user',
    firstName: 'Тест',
    lastName: null,
    languageCode: 'ru',
    photoUrl: null,
    isPremium: false,
  },
  roles: ['coach', 'client'],
};

function launch(initData: string) {
  vi.mocked(getTelegramWebApp).mockReturnValue({
    initData,
    colorScheme: 'dark',
    ready: vi.fn(),
    expand: vi.fn(),
  });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => cleanup());

describe('client invite launch routing', () => {
  it('shows a valid client invite before a previously selected coach role', async () => {
    const initData = `auth_date=1&start_param=invite_${'a'.repeat(36)}`;
    window.localStorage.setItem('mezfit.activeRole', 'coach');
    launch(initData);
    vi.mocked(getMe).mockResolvedValue(dualRoleMe);
    vi.mocked(getCurrentInvite).mockResolvedValue({ invite });

    render(<App />);

    expect(await screen.findByText('Анна Иванова приглашает вас в Mezfit')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Подключиться к тренеру' })).toBeTruthy();
    expect(screen.queryByText('coach-shell')).toBeNull();
    expect(getCurrentInvite).toHaveBeenCalledWith(initData);
  });

  it('shows a valid client invite before the first-run role picker', async () => {
    const initData = `auth_date=1&start_param=invite_${'b'.repeat(36)}`;
    launch(initData);
    vi.mocked(getMe).mockResolvedValue({ ...dualRoleMe, roles: [] });
    vi.mocked(getCurrentInvite).mockResolvedValue({ invite });

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Подключиться к тренеру' })).toBeTruthy();
    expect(screen.queryByText('Как вы будете использовать Mezfit?')).toBeNull();
  });

  it('switches to client mode only after the backend accepts the invite', async () => {
    const initData = `auth_date=1&start_param=invite_${'c'.repeat(36)}`;
    window.localStorage.setItem('mezfit.activeRole', 'coach');
    launch(initData);
    vi.mocked(getMe).mockResolvedValue(dualRoleMe);
    vi.mocked(getCurrentInvite).mockResolvedValue({ invite });
    vi.mocked(acceptCurrentInvite).mockResolvedValue({ ok: true, roles: ['coach', 'client'] });

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Подключиться к тренеру' }));

    await waitFor(() => {
      expect(screen.getByTestId('navigation-shell').getAttribute('data-role')).toBe('client');
    });
    expect(screen.getByText('Вы подключены к тренеру. Назначенная программа появится здесь.')).toBeTruthy();
    expect(window.localStorage.getItem('mezfit.activeRole')).toBe('client');
  });
});
