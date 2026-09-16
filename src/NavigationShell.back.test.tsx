// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigationShell } from './NavigationShell';
import type { TelegramBackButton } from './telegram';

let telegramBackHandler: (() => void) | null = null;
let backButton: TelegramBackButton;

beforeEach(() => {
  telegramBackHandler = null;
  backButton = {
    show: vi.fn(),
    hide: vi.fn(),
    onClick: vi.fn((callback) => { telegramBackHandler = callback; }),
    offClick: vi.fn(),
  };
  window.Telegram = {
    WebApp: {
      initData: 'telegram-init',
      colorScheme: 'dark',
      ready: vi.fn(),
      expand: vi.fn(),
      BackButton: backButton,
    },
  };
  window.history.replaceState({}, '');
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '');
  delete window.Telegram;
  vi.restoreAllMocks();
});

const me = {
  user: {
    id: 1,
    telegramUserId: '1',
    username: null,
    firstName: 'Test',
    lastName: null,
    languageCode: 'ru',
    photoUrl: null,
    isPremium: false,
  },
  roles: ['client' as const],
};

describe('NavigationShell nested back behavior', () => {
  it('uses the browser history entry for both the app-bar and Telegram back controls', async () => {
    const onBack = vi.fn();
    const browserBack = vi.spyOn(window.history, 'back').mockImplementation(() => {});

    render(
      <NavigationShell
        me={me}
        activeRole="client"
        destination="today"
        context={{ title: 'Тренировка', onBack }}
        onDestinationChange={vi.fn()}
        onRoleSwitch={vi.fn()}
      >
        <div>Nested content</div>
      </NavigationShell>,
    );

    await waitFor(() => expect(backButton.show).toHaveBeenCalledTimes(1));
    expect(telegramBackHandler).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(browserBack).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();

    telegramBackHandler?.();
    expect(browserBack).toHaveBeenCalledTimes(2);
  });

  it('routes a browser popstate event through the active navigation context', async () => {
    const onBack = vi.fn();

    render(
      <NavigationShell
        me={me}
        activeRole="client"
        destination="today"
        context={{ title: 'Детали', onBack }}
        onDestinationChange={vi.fn()}
        onRoleSwitch={vi.fn()}
      >
        <div>Nested content</div>
      </NavigationShell>,
    );

    await waitFor(() => expect(backButton.show).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
