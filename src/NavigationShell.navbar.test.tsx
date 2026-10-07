/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigationShell, useNavigationFloatingAction, useNavigationSurfaceFloatingAction } from './NavigationShell';
import { FloatingActionButton, GlassSurfaceProvider } from './ui';
import { getUiIconAsset, type UiIconName } from './ui/icons/registry';

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

function expectTabIcon(root: ShadowRoot, label: string, iconName: UiIconName) {
  const icon = root.querySelector<HTMLElement>(`[role="tab"][aria-label="${label}"] .tab-icon-outline .ui-icon`);
  expect(icon).not.toBeNull();
  expect(icon?.style.maskImage).toContain(getUiIconAsset(iconName, 'outline'));
}

const programFloatingAction = {
  label: 'Создать программу',
  onClick: vi.fn(),
  content: <span>＋</span>,
};

function ProgramFloatingActionRegistration() {
  useNavigationFloatingAction('programs', programFloatingAction);
  return null;
}

function SurfaceFloatingActionRegistration() {
  useNavigationSurfaceFloatingAction({
    label: 'Действие вложенной страницы',
    onClick: vi.fn(),
    icon: 'plus',
  });
  return null;
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
    const programsTab = tabsRoot.querySelector<HTMLButtonElement>('[role="tab"][aria-label="Программы"]');
    expect(todayTab?.getAttribute('aria-selected')).toBe('true');
    expect(tabsRoot.querySelectorAll('[role="tab"]')).toHaveLength(5);
    expect(tabsRoot.querySelector('[role="tab"][aria-label="Тренировка"]')).not.toBeNull();
    expect(tabsRoot.querySelector('[role="tab"][aria-label="Аналитика"]')).not.toBeNull();
    expect(tabsRoot.querySelector('[role="tab"][aria-label="Настройки"]')).not.toBeNull();
    expectTabIcon(tabsRoot, 'Сегодня', 'calendar-event');
    expectTabIcon(tabsRoot, 'Тренировка', 'barbell');
    expectTabIcon(tabsRoot, 'Программы', 'clipboard-list');
    expectTabIcon(tabsRoot, 'Аналитика', 'chart-dots-2');
    expectTabIcon(tabsRoot, 'Настройки', 'settings');
    if (!programsTab) throw new Error('Missing Programs liquid glass tab');

    fireEvent.click(programsTab);
    expect(onDestinationChange).toHaveBeenCalledWith('programs');
  });

  it('forwards the shared glass preset and inherits global blur in navbar and primary tabs', () => {
    const view = render(
      <GlassSurfaceProvider blur={7}>
        <NavigationShell
          me={me}
          activeRole="client"
          destination="today"
          context={null}
          onDestinationChange={vi.fn()}
          onRoleSwitch={vi.fn()}
          glassPreset="clear"
        >
          <div>Today content</div>
        </NavigationShell>
      </GlassSurfaceProvider>,
    );

    const navbarSurfaces = [
      ...view.container.querySelectorAll<HTMLElement>('.ui-mezfit-navbar .ui-glass-surface'),
    ];
    expect(navbarSurfaces).toHaveLength(3);
    for (const surface of navbarSurfaces) {
      expect(surface.style.getPropertyValue('--ui-glass-surface-blur')).toBe('7px');
    }

    const primaryTabsSurface = getPrimaryTabsRoot(view.container).getElementById('toolbar-pane');
    expect(primaryTabsSurface?.classList.contains('ui-glass-surface')).toBe(true);
    expect(primaryTabsSurface?.style.getPropertyValue('--ui-glass-surface-blur')).toBe('7px');
  });

  it('shares shell material settings with both the tab-slot FAB and page-owned FABs', () => {
    const onClick = vi.fn();
    const view = render(
      <NavigationShell
        me={me}
        activeRole="client"
        destination="today"
        context={null}
        onDestinationChange={vi.fn()}
        onRoleSwitch={vi.fn()}
        glassPreset="frosted"
        glassOptics={false}
        floatingAction={{ label: 'Действие навигации', onClick, content: '+' }}
      >
        <FloatingActionButton label="Действие страницы">ОК</FloatingActionButton>
      </NavigationShell>,
    );

    for (const label of ['Действие навигации', 'Действие страницы']) {
      const button = view.getByRole('button', { name: label });
      expect(button.classList.contains('ui-glass-surface')).toBe(true);
      expect(button.style.getPropertyValue('--ui-glass-surface-blur')).toBe('14px');
    }
    fireEvent.click(view.getByRole('button', { name: 'Действие навигации' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('uses Training as the fifth coach tab and keeps Settings in the system menu before About', () => {
    const coachMe = { ...me, roles: ['coach' as const] };
    const view = render(
      <NavigationShell
        me={coachMe}
        activeRole="coach"
        destination="clients"
        context={null}
        onDestinationChange={vi.fn()}
        onRoleSwitch={vi.fn()}
      >
        <div>Clients content</div>
      </NavigationShell>,
    );

    const tabsRoot = getPrimaryTabsRoot(view.container);
    expect(tabsRoot.querySelectorAll('[role="tab"]')).toHaveLength(5);
    expectTabIcon(tabsRoot, 'Сегодня', 'calendar-event');
    expectTabIcon(tabsRoot, 'Клиенты', 'users');
    expectTabIcon(tabsRoot, 'Программы', 'clipboard-list');
    expectTabIcon(tabsRoot, 'Аналитика', 'chart-dots-2');
    expectTabIcon(tabsRoot, 'Тренировка', 'barbell');
    expect(tabsRoot.querySelector('[role="tab"][aria-label="Настройки"]')).toBeNull();

    const menuButton = view.getByRole('button', { name: 'Меню страницы' });
    fireEvent.pointerDown(menuButton, { pointerType: 'touch', button: 0 });
    fireEvent.click(menuButton);
    const menuLabels = view.getAllByRole('menuitem').map((item) => item.textContent);
    expect(menuLabels).toEqual(['Упражнения', 'Календарь', 'Настройки', 'О приложении']);
  });

  it('renders a page-owned primary action through the tab-bar FAB slot', () => {
    const view = render(
      <NavigationShell
        me={me}
        activeRole="client"
        destination="programs"
        context={null}
        onDestinationChange={vi.fn()}
        onRoleSwitch={vi.fn()}
        floatingAction={{
          label: 'Открыть тренировку',
          onClick: vi.fn(),
          content: <span>W</span>,
        }}
      >
        <ProgramFloatingActionRegistration />
      </NavigationShell>,
    );

    expect(view.getByRole('button', { name: 'Создать программу' })).not.toBeNull();
    expect(view.queryByRole('button', { name: 'Открыть тренировку' })).toBeNull();
    expect(view.container.querySelector('[data-liquid-glass-fab-slot]')).not.toBeNull();
  });

  it('keeps Settings as the fifth selected primary tab with no FAB', () => {
    const view = render(
      <NavigationShell
        me={me}
        activeRole="client"
        destination="settings"
        context={null}
        onDestinationChange={vi.fn()}
        onRoleSwitch={vi.fn()}
        floatingAction={{
          label: 'Открыть тренировку',
          onClick: vi.fn(),
          content: <span>W</span>,
        }}
      >
        <div>Settings content</div>
      </NavigationShell>,
    );

    const tabsRoot = getPrimaryTabsRoot(view.container);
    const settingsTab = tabsRoot.querySelector('[role="tab"][aria-label="Настройки"]');
    expect(tabsRoot.querySelectorAll('[role="tab"]')).toHaveLength(5);
    expect(settingsTab?.getAttribute('aria-selected')).toBe('true');
    expect(view.container.querySelector('[data-liquid-glass-fab-slot]')).toBeNull();
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

    const menuButton = view.getByRole('button', { name: 'Меню страницы' });
    fireEvent.pointerDown(menuButton, { pointerType: 'touch', button: 0 });
    fireEvent.click(menuButton);
    expect(view.getByRole('menu', { name: 'Меню страницы' })).not.toBeNull();
    fireEvent.click(view.getByRole('menuitem', { name: 'Обновить день' }));

    expect(pageAction).toHaveBeenCalledTimes(1);
  });

  it('lets a level-one schedule own viewport layout and navbar calendar state', () => {
    const onCalendarDateChange = vi.fn();
    const view = render(
      <NavigationShell
        me={me}
        activeRole="client"
        destination="today"
        context={{
          level: 1,
          title: 'Пн, 5 октября',
          identity: { title: 'Пн, 5 октября', icon: 'calendar-event' },
          calendar: { value: '2026-10-05', onChange: onCalendarDateChange },
          contentMode: 'viewport',
        }}
        onDestinationChange={vi.fn()}
        onRoleSwitch={vi.fn()}
      >
        <div>Schedule content</div>
      </NavigationShell>,
    );

    expect(view.container.querySelector('.navigation-content')?.classList.contains('navigation-content--viewport')).toBe(true);
    const identity = view.container.querySelector('.ui-mezfit-navbar__identity .ui-identity-action');
    expect(identity?.getAttribute('aria-label')).toBe('Пн, 5 октября');
    expect(view.getByRole('button', { name: 'Открыть календарь' })).not.toBeNull();
  });

  it('closes the calendar when primary navigation changes', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => (
      window.setTimeout(() => callback(0), 0)
    ));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));

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

    const calendarButton = view.getByRole('button', { name: 'Открыть календарь' });
    const identityAction = view.container.querySelector<HTMLElement>('.ui-identity-action--double');
    if (!identityAction) throw new Error('Missing double identity action');
    fireEvent.pointerDown(calendarButton, { pointerType: 'touch', button: 0 });
    fireEvent.click(calendarButton);
    fireEvent.animationEnd(identityAction);

    const panel = view.container.querySelector<HTMLElement>('[data-date-picker-surface="top-panel"]');
    await waitFor(() => {
      expect(panel?.getAttribute('data-state')).toBe('opened');
    });

    const programsTab = getPrimaryTabsRoot(view.container)
      .querySelector<HTMLButtonElement>('[role="tab"][aria-label="Программы"]');
    if (!programsTab) throw new Error('Missing Programs liquid glass tab');
    fireEvent.click(programsTab);

    expect(panel?.getAttribute('data-state')).toBe('closed');
  });

  it('closes the calendar before nested Back navigation', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => (
      window.setTimeout(() => callback(0), 0)
    ));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));

    const view = render(
      <NavigationShell
        me={me}
        activeRole="client"
        destination="today"
        context={{
          title: 'Детали',
          identity: { title: 'Детали', icon: 'calendar-event' },
          calendar: { value: '2026-10-05', onChange: vi.fn() },
          onBack: vi.fn(),
        }}
        onDestinationChange={vi.fn()}
        onRoleSwitch={vi.fn()}
      >
        <div>Nested content</div>
      </NavigationShell>,
    );

    const calendarButton = view.getByRole('button', { name: 'Открыть календарь' });
    const identityAction = view.container.querySelector<HTMLElement>('.ui-identity-action--double');
    if (!identityAction) throw new Error('Missing double identity action');
    fireEvent.pointerDown(calendarButton, { pointerType: 'touch', button: 0 });
    fireEvent.click(calendarButton);
    fireEvent.animationEnd(identityAction);

    const panel = view.container.querySelector<HTMLElement>('[data-date-picker-surface="top-panel"]');
    await waitFor(() => {
      expect(panel?.getAttribute('data-state')).toBe('opened');
    });

    const navbarBack = view.getByRole('button', { name: 'Назад' });
    fireEvent.click(navbarBack);
    fireEvent.animationEnd(navbarBack);
    await waitFor(() => {
      expect(panel?.getAttribute('data-state')).toBe('closed');
    });
  });

  it('opens the page menu immediately without waiting for the shared double-action animation', () => {
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

    const menuButton = view.getByRole('button', { name: 'Меню страницы' });
    fireEvent.pointerDown(menuButton, { pointerType: 'touch', button: 0 });
    fireEvent.click(menuButton);

    const doubleAction = view.container.querySelector('.ui-identity-action--double');
    expect(doubleAction).not.toBeNull();
    expect(doubleAction?.classList.contains('ui-identity-action--animating')).toBe(true);
    expect(view.getByRole('menu', { name: 'Меню страницы' })).not.toBeNull();
  });

  it('renders a level-two surface FAB outside the page scroller and keeps root fallback hidden', () => {
    const view = render(
      <NavigationShell
        me={me}
        activeRole="client"
        destination="today"
        context={{ title: 'Тренировка', scrollKey: 'workout:root', onBack: vi.fn() }}
        onDestinationChange={vi.fn()}
        onRoleSwitch={vi.fn()}
        floatingAction={{ label: 'Открыть тренировку', onClick: vi.fn(), icon: 'barbell' }}
      >
        <SurfaceFloatingActionRegistration />
      </NavigationShell>,
    );

    const button = view.getByRole('button', { name: 'Действие вложенной страницы' });
    const scroll = view.container.querySelector('.navigation-content');
    expect(button.closest('.navigation-surface-fab-layer')).not.toBeNull();
    expect(scroll?.contains(button)).toBe(false);
    expect(view.queryByRole('button', { name: 'Открыть тренировку' })).toBeNull();
    expect(view.container.querySelector('.navigation-primary-tabs > div')?.hasAttribute('hidden')).toBe(true);
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
