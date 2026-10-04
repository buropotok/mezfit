// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMe } from './api';
import { App } from './App';
import { getUiIconAsset } from './ui/icons/registry';

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
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
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
  vi.unstubAllGlobals();
});

describe('workout FAB artwork', () => {
  it('renders the shared outlined barbell in the left FAB and opens the workout', async () => {
    render(<App />);

    expect(await screen.findByText('Coach home')).toBeTruthy();
    const launcher = screen.getByRole('button', { name: 'Открыть тренировку' });
    const icon = launcher.querySelector<HTMLElement>('.ui-icon');

    expect(launcher.className).toContain('ui-fab--left');
    expect(icon?.style.maskImage).toContain(getUiIconAsset('barbell', 'outline'));
    expect(icon?.style.width).toBe('36px');
    expect(icon?.style.height).toBe('36px');
    expect(launcher.querySelector('img')).toBeNull();

    fireEvent.click(launcher);
    expect(screen.getByText('Workout session')).toBeTruthy();
  });
});
