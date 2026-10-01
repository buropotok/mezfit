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
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'touch';
    }
  });
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
    const tabsRoot = getPrimaryTabsRoot(view.container);
    const todayTab = tabsRoot.querySelector<HTMLButtonElement>('[role="tab"][aria-label="Сегодня"]');
    const programsTab = tabsRoot.querySelector<HTMLButtonElement>('[role="tab"][aria-label="Программа"]');
    expect(todayTab?.getAttribute('aria-selected')).toBe('true');
    if (!programsTab) throw new Error('Missing Program liquid glass tab');

    fireEvent.click(programsTab);
    expect(onDestinationChange).toHaveBeenCalledWith('programs');
  });

  it('keeps bottom tabs visible but unselected for a secondary level-one destination', () => {
    const view = render(
      <NavigationShell
        me={me}
        activeRole="client"
        destination="settings"
        context={null}
        onDestinationChange={vi.fn()}
        onRoleSwitch={vi.fn()}
      >
        <div>Settings content</div>
      </NavigationShell>,
    );

    const tabsRoot = getPrimaryTabsRoot(view.container);
    expect([...tabsRoot.querySelectorAll('[role="tab"]')].some(tab => tab.getAttribute('aria-selected') === 'true')).toBe(false);
    expect((tabsRoot.getElementById('selector-track') as HTMLElement | null)?.style.visibility).toBe('hidden');
    expect((tabsRoot.getElementById('lens-track') as HTMLElement | null)?.style.visibility).toBe('hidden');
  });

  it('allows level-one pages to provide contextual identity and menu actions without creating Back history', () => {
    const pageAction = vi.fn();
    const view = render(
      <NavigationShell
        me={me}
        activeRole="client"
        destination="today"
        context={{
          level: 1,
          title: 'Сегодня',
          identity: { title: 'Мой день', icon: 'home' },
          menuActions: [{ id: 'refresh', label: 'Обновить день', onSelect: pageAction }],
        }}
        onDestinationChange={vi.fn()}
        onRoleSwitch={vi.fn()}
      >
        <div>Today content</div>
      </NavigationShell>,
    );

    const identity = view.container.querySelector('.ui-mezfit-navbar__identity .ui-identity-action');
    expect(identity?.getAttribute('aria-label')).toBe('Мой день');
    expect(getPrimaryTabsRoot(view.container).querySelector('[role="tab"][aria-label="Сегодня"]')).not.toBeNull();
    expect(view.container.querySelector('.ui-mezfit-navbar__side--left')?.getAttribute('aria-hidden')).toBe('true');

    fireEvent.click(view.getByRole('button', { name: 'Меню страницы' }));
    const doubleAction = view.container.querySelector('.ui-identity-action--double');
    fireEvent.animationEnd(doubleAction as Element);
    fireEvent.click(view.getByRole('menuitem', { name: 'Обновить день' }));

    expect(pageAction).toHaveBeenCalledTimes(1);
  });

  it('opens the page menu only after the shared double-action animation completes', () => {
    const view = render(
      <NavigationShell
        me={me}
        activeRole="client"
        destination="today"
        context={null}
        onDestinationChange={vi.fn()}
        onRoleSwitch={vi.fn()}
      >
        <div>Today content</div>
      </NavigationShell>,
    );

    fireEvent.click(view.getByRole('button', { name: 'Меню страницы' }));
    expect(view.queryByRole('menu', { name: 'Меню страницы' })).toBeNull();

    const doubleAction = view.container.querySelector('.ui-identity-action--double');
    expect(doubleAction).not.toBeNull();
    fireEvent.animationEnd(doubleAction as Element);

    expect(view.getByRole('menu', { name: 'Меню страницы' })).not.toBeNull();
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
    expect(view.container.querySelector('.navigation-primary-tabs > div')?.hasAttribute('hidden')).toBe(true);
    expect(view.getByRole('button', { name: 'Назад' })).not.toBeNull();
  });
});
