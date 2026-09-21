// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acceptCurrentInvite,
  getClientCoaches,
  getCurrentInvite,
  getMe,
} from './api';
import { App } from './App';

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return {
    ...actual,
    acceptCurrentInvite: vi.fn(),
    getClientCoaches: vi.fn(),
    getCurrentInvite: vi.fn(),
    getMe: vi.fn(),
  };
});

vi.mock('./NavigationShell', () => ({
  NavigationShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const acceptCurrentInviteMock = vi.mocked(acceptCurrentInvite);
const getClientCoachesMock = vi.mocked(getClientCoaches);
const getCurrentInviteMock = vi.mocked(getCurrentInvite);
const getMeMock = vi.mocked(getMe);

const oldCoach = {
  relationshipId: 1,
  user: {
    id: 20,
    telegramUserId: '200',
    username: 'old_coach',
    firstName: 'Старый',
    lastName: 'Тренер',
    languageCode: 'ru',
    photoUrl: null,
    isPremium: false,
  },
};

const newCoach = {
  relationshipId: 2,
  user: {
    id: 30,
    telegramUserId: '300',
    username: 'new_coach',
    firstName: 'Новый',
    lastName: 'Тренер',
    languageCode: 'ru',
    photoUrl: null,
    isPremium: false,
  },
};

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('mezfit.selectedCoachUserId.10', String(oldCoach.user.id));
  window.history.replaceState({}, '', `/?tgWebAppStartParam=invite_${'b'.repeat(36)}`);

  getMeMock.mockReset();
  getCurrentInviteMock.mockReset();
  acceptCurrentInviteMock.mockReset();
  getClientCoachesMock.mockReset();

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
  getClientCoachesMock
    .mockResolvedValueOnce({ coaches: [oldCoach] })
    .mockResolvedValue({ coaches: [oldCoach, newCoach] });

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
      expect(getClientCoachesMock).toHaveBeenCalledTimes(2);
    });

    expect(window.localStorage.getItem('mezfit.selectedCoachUserId.10'))
      .toBe(String(oldCoach.user.id));
  });
});
