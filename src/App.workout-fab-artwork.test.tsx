// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMe } from './api';
import { App } from './App';
import workoutFabIconUrl from './assets/workout-fab.jpg';

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

describe('workout FAB artwork', () => {
  it('renders the approved workout artwork as the full content of the left FAB', async () => {
    render(<App />);

    expect(await screen.findByText('Coach home')).toBeTruthy();
    const launcher = screen.getByRole('button', { name: 'Открыть тренировку' });
    const image = launcher.querySelector('img');

    expect(launcher.className).toContain('ui-fab--left');
    expect(image?.getAttribute('src')).toBe(workoutFabIconUrl);
    expect(image?.style.width).toBe('100%');
    expect(image?.style.height).toBe('100%');
    expect(image?.style.borderRadius).toBe('50%');
    expect(image?.style.objectFit).toBe('cover');
  });
});
