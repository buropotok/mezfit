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
  getTelegramStartParam: vi.fn(),
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
import { getTelegramStartParam, getTelegramWebApp } from './telegram';

const invite: ClientInvitePreview = {
  label: null,
  expiresAt: '2026-10-21T00:00:00Z',
  coach: {
    firstName: 'Анна',
    lastName: 'Иванова',
    username: 'anna',
  },
};

const existingClientMe: MeResponse = {
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
  roles: ['client'],
};

function launch(initData: string, startParam?: string) {
  vi.mocked(getTelegramWebApp).mockReturnValue({
    initData,
    colorScheme: 'dark',
    ready: vi.fn(),
    expand: vi.fn(),
  });
  vi.mocked(getTelegramStartParam).mockReturnValue(startParam);
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => cleanup());

describe('client invite launch routing', () => {
  it('shows an invite for a second coach when signed initData has no start_param', async () => {
    const initData = 'auth_date=1';
    const startParam = `invite_${'a'.repeat(36)}`;
    window.localStorage.setItem('mezfit.activeRole', 'client');
    launch(initData, startParam);
    vi.mocked(getMe).mockResolvedValue(existingClientMe);
    vi.mocked(getCurrentInvite).mockResolvedValue({ invite });

    render(<App />);

    expect(await screen.findByText('Анна Иванова приглашает вас в Mezfit')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Подключиться к тренеру' })).toBeTruthy();
    expect(screen.queryByText('Тренировка')).toBeNull();
    expect(getCurrentInvite).toHaveBeenCalledWith(initData, startParam);
  });

  it('does not replace the current client screen when there is no invite launch parameter', async () => {
    const initData = 'auth_date=1';
    window.localStorage.setItem('mezfit.activeRole', 'client');
    launch(initData);
    vi.mocked(getMe).mockResolvedValue(existingClientMe);

    render(<App />);

    expect(await screen.findByText('Тренировка')).toBeTruthy();
    expect(getCurrentInvite).not.toHaveBeenCalled();
  });

  it('accepts the second-coach invite with the same launch parameter and returns to client mode', async () => {
    const initData = 'auth_date=1';
    const startParam = `invite_${'c'.repeat(36)}`;
    window.localStorage.setItem('mezfit.activeRole', 'client');
    launch(initData, startParam);
    vi.mocked(getMe).mockResolvedValue(existingClientMe);
    vi.mocked(getCurrentInvite).mockResolvedValue({ invite });
    vi.mocked(acceptCurrentInvite).mockResolvedValue({ ok: true, roles: ['client'] });

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Подключиться к тренеру' }));

    await waitFor(() => {
      expect(acceptCurrentInvite).toHaveBeenCalledWith(initData, startParam);
      expect(screen.getByTestId('navigation-shell').getAttribute('data-role')).toBe('client');
    });
    expect(screen.getByText('Вы подключены к тренеру. Назначенная программа появится здесь.')).toBeTruthy();
  });
});
