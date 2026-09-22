// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse } from './api';
import { NavigationShell, type NavigationContext } from './NavigationShell';

vi.mock('./telegram', () => ({
  bindTelegramBackButton: vi.fn(() => () => {}),
  getTelegramWebApp: vi.fn(() => null),
}));

const me: MeResponse = {
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
  roles: ['client'],
};

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '');
});

describe('NavigationShell nested back context', () => {
  it('keeps the visible app bar context while routing browser back to the nested workflow', () => {
    const outerBack = vi.fn();
    const nestedBack = vi.fn();
    const visibleContext: NavigationContext = { title: 'Тренировка', onBack: outerBack };
    const backContext: NavigationContext = { title: 'Упражнения', onBack: nestedBack };

    render(
      <NavigationShell
        me={me}
        activeRole="client"
        destination="today"
        context={visibleContext}
        backContext={backContext}
        onDestinationChange={vi.fn()}
        onRoleSwitch={vi.fn()}
      >
        <div>Контент</div>
      </NavigationShell>,
    );

    expect(screen.getByRole('heading', { name: 'Тренировка' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Упражнения' })).toBeNull();

    fireEvent.popState(window);

    expect(nestedBack).toHaveBeenCalledTimes(1);
    expect(outerBack).not.toHaveBeenCalled();
  });
  it('keeps existing behavior when no separate back context is provided', () => {
    const visibleBack = vi.fn();
    const visibleContext: NavigationContext = { title: 'Тренировка', onBack: visibleBack };

    render(
      <NavigationShell
        me={me}
        activeRole="client"
        destination="today"
        context={visibleContext}
        onDestinationChange={vi.fn()}
        onRoleSwitch={vi.fn()}
      >
        <div>Контент</div>
      </NavigationShell>,
    );

    fireEvent.popState(window);

    expect(visibleBack).toHaveBeenCalledTimes(1);
  });
});
