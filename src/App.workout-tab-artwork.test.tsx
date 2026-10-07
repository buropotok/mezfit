// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
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

function getPrimaryTabsRoot(container: HTMLElement): ShadowRoot {
  const wrapper = container.querySelector<HTMLElement>('.navigation-primary-tabs > div');
  const host = wrapper?.firstElementChild;
  if (!(host instanceof HTMLElement) || !host.shadowRoot) {
    throw new Error('LiquidGlassIconOnly must expose its production shadow scene');
  }
  return host.shadowRoot;
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function(this: HTMLElement) {
    return this.classList.contains('tab-link') ? 78 : 390;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(64);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    const width = this.classList.contains('tab-link') ? 78 : 390;
    const left = Number(this.dataset.index ?? 0) * 78;
    return { x: left, y: 0, left, top: 0, right: left + width, bottom: 64, width, height: 64, toJSON: () => ({}) };
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('workout primary tab artwork', () => {
  it('renders the shared barbell artwork as the coach fifth tab instead of Settings', async () => {
    const view = render(<App />);

    expect(await screen.findByText('Coach home')).toBeTruthy();
    const tabsRoot = getPrimaryTabsRoot(view.container);
    const trainingTab = tabsRoot.querySelector<HTMLElement>('[role="tab"][aria-label="Тренировка"]');
    const outlineIcon = trainingTab?.querySelector<HTMLElement>('.tab-icon-outline .ui-icon');
    const filledIcon = trainingTab?.querySelector<HTMLElement>('.tab-icon-filled .ui-icon');

    expect(tabsRoot.querySelectorAll('[role="tab"]')).toHaveLength(5);
    expect(trainingTab).not.toBeNull();
    expect(tabsRoot.querySelector('[role="tab"][aria-label="Настройки"]')).toBeNull();
    expect(outlineIcon?.style.maskImage).toContain(getUiIconAsset('barbell', 'outline'));
    expect(filledIcon?.style.maskImage).toContain(getUiIconAsset('barbell', 'filled'));
  });
});
