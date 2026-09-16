// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMe } from './api';
import { App } from './App';

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return {
    ...actual,
    getMe: vi.fn(),
  };
});

vi.mock('./coach/CoachShell', () => ({
  CoachShell: () => <div>Coach home</div>,
}));

vi.mock('./workout', () => ({
  WorkoutSessionScreen: () => <div>Workout session</div>,
}));

const getMeMock = vi.mocked(getMe);

beforeEach(() => {
  window.localStorage.clear();
  getMeMock.mockReset();
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
});

describe('App workout launcher', () => {
  it('opens the real workout surface from the global left-side FAB entry point', async () => {
    render(<App />);

    expect(await screen.findByText('Coach home')).toBeTruthy();
    const launcher = screen.getByRole('button', { name: 'Открыть тренировку' });
    expect(launcher.className).toContain('ui-fab--left');

    fireEvent.click(launcher);

    expect(await screen.findByText('Workout session')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Открыть тренировку' })).toBeNull();
  });
});
