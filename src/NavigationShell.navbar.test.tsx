/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigationShell } from './NavigationShell';

vi.mock('./client/ClientCoachSelectorModal', () => ({
  ClientCoachSelectorModal: () => null,
}));

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

beforeEach(() => {
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('NavigationShell MezfitNavbar integration', () => {
  it('derives level-one identity from destination and delegates destination changes to bottom tabs', () => {
    const onDestinationChange = vi.fn();
    const view = render(
      <NavigationShell
        me={me}
        activeRole="client"
        destination="today"
        context={null}
        onDestinationChange={onDestinationChange}
        onRoleSwitch={vi.fn()}
      >
        <div>Today content</div>
      </NavigationShell>,
    );

    const identity = view.container.querySelector('.ui-mezfit-navbar__identity .ui-identity-action');
    expect(identity?.getAttribute('aria-label')).toBe('Сегодня');
    expect(view.getByRole('tab', { name: 'Сегодня' }).getAttribute('data-state')).toBe('active');

    fireEvent.click(view.getByRole('tab', { name: 'Программа' }));
    expect(onDestinationChange).toHaveBeenCalledWith('programs');
  });

  it('uses a contextual avatar identity and hides first-level tabs on level two', () => {
    const view = render(
      <NavigationShell
        me={me}
        activeRole="client"
        destination="today"
        context={{
          title: 'Анна Смирнова',
          identity: {
            title: 'Анна Смирнова',
            avatar: { name: 'Анна Смирнова' },
          },
          onBack: vi.fn(),
        }}
        onDestinationChange={vi.fn()}
        onRoleSwitch={vi.fn()}
      >
        <div>Client content</div>
      </NavigationShell>,
    );

    expect(view.container.querySelector('.ui-mezfit-navbar__identity .ui-avatar')).not.toBeNull();
    expect(view.queryByRole('tab', { name: 'Сегодня' })).toBeNull();
    expect(view.getByRole('button', { name: 'Назад' })).not.toBeNull();
  });
});
