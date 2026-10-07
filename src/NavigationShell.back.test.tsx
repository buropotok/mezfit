// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigationShell, type NavigationContext } from './NavigationShell';
import type { TelegramBackButton } from './telegram';

vi.mock('./client/ClientCoachSelectorModal', () => ({
  ClientCoachSelectorModal: () => null,
}));

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
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  window.history.replaceState({}, '');
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '');
  delete window.Telegram;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
  it('uses the browser history entry for both the animated navbar Back action and Telegram back controls', async () => {
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

    const navbarBack = screen.getByRole('button', { name: 'Назад' });
    fireEvent.click(navbarBack);

    expect(browserBack).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();

    fireEvent.animationEnd(navbarBack);

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

  it('supports a settings root plus one deeper settings surface as two sequential Back transitions', async () => {
    function Harness() {
      const [surface, setSurface] = useState<'outside' | 'settings' | 'typography'>('settings');
      const context: NavigationContext | null = surface === 'typography'
        ? { title: 'Шрифты', scrollKey: 'settings:typography', onBack: () => setSurface('settings') }
        : surface === 'settings'
          ? { level: 2, title: 'Настройки', scrollKey: 'settings:root', onBack: () => setSurface('outside') }
          : null;

      return (
        <NavigationShell
          me={{ ...me, roles: ['coach'] }}
          activeRole="coach"
          destination="settings"
          context={context}
          onDestinationChange={vi.fn()}
          onRoleSwitch={vi.fn()}
        >
          {surface === 'settings' ? (
            <button type="button" onClick={() => setSurface('typography')}>Open typography</button>
          ) : (
            <div>{surface === 'typography' ? 'Typography settings' : 'Outside settings'}</div>
          )}
        </NavigationShell>
      );
    }

    const view = render(<Harness />);
    await waitFor(() => expect(backButton.show).toHaveBeenCalled());

    fireEvent.click(view.getByRole('button', { name: 'Open typography' }));
    expect(view.getByText('Typography settings')).toBeTruthy();

    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(await view.findByRole('button', { name: 'Open typography' })).toBeTruthy();

    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(await view.findByText('Outside settings')).toBeTruthy();
  });
});
