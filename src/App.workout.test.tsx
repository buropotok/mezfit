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

    expect(await screen.findByText('Workout session')).toBeTruthy();
  });
});
