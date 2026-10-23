/** @vitest-environment jsdom */
import { act, cleanup, render } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigationShell } from './NavigationShell';

vi.mock('./client/ClientCoachSelectorModal', () => ({ ClientCoachSelectorModal: () => null }));

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

let width = 320;
const shellObservers: ResizeObserverCallback[] = [];

beforeEach(() => {
  width = 320;
  shellObservers.length = 0;
  vi.stubGlobal('ResizeObserver', class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(element: Element) {
      if (element.classList.contains('navigation-shell')) shellObservers.push(this.callback);
    }
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
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('navigation-shell') ? width : 0;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('responsive semantic typography in NavigationShell', () => {
  it('derives scale from the 320px working shell and leaves the preset tokens alone', () => {
    const view = render(
      <NavigationShell
        me={me}
        activeRole="client"
        destination="settings"
        context={null}
        onDestinationChange={vi.fn()}
        onRoleSwitch={vi.fn()}
        previewWidth={320}
      >
        <div>Settings</div>
      </NavigationShell>,
    );
    const shell = view.container.querySelector<HTMLElement>('.navigation-shell');
    expect(shell?.style.getPropertyValue('--ui-responsive-type-scale')).toBe('0.9');
    expect(document.documentElement.style.getPropertyValue('--ui-responsive-type-scale')).toBe('0.9');
    expect(document.documentElement.style.getPropertyValue('--ui-font-size-headline')).toBe('');
    view.unmount();
    expect(document.documentElement.style.getPropertyValue('--ui-responsive-type-scale')).toBe('');
  });
  it('keeps body portals at the shell scale as it resizes without re-saving typography', () => {
    const view = render(
      <NavigationShell
        me={me}
        activeRole="client"
        destination="settings"
        context={null}
        onDestinationChange={vi.fn()}
        onRoleSwitch={vi.fn()}
        previewWidth={320}
      >
        {createPortal(<span data-testid="portal-title">Portal title</span>, document.body)}
      </NavigationShell>,
    );
    const shell = view.container.querySelector<HTMLElement>('.navigation-shell');
    const overlay = document.body.querySelector('[data-testid="portal-title"]');

    expect(overlay).not.toBeNull();
    expect(shell?.contains(overlay)).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--ui-responsive-type-scale')).toBe('0.9');

    act(() => {
      width = 406;
      shellObservers.forEach(callback => callback([], {} as ResizeObserver));
    });
    expect(shell?.style.getPropertyValue('--ui-responsive-type-scale')).toBe('1');
    expect(document.documentElement.style.getPropertyValue('--ui-responsive-type-scale')).toBe('1');

    view.unmount();
    expect(document.body.querySelector('[data-testid="portal-title"]')).toBeNull();
    expect(document.documentElement.style.getPropertyValue('--ui-responsive-type-scale')).toBe('');
  });

  it('restores an earlier inline scale and priority when the shell unmounts', () => {
    const root = document.documentElement;
    const property = '--ui-responsive-type-scale';
    root.style.setProperty(property, '0.84', 'important');
    try {
      const view = render(
        <NavigationShell
          me={me}
          activeRole="client"
          destination="settings"
          context={null}
          onDestinationChange={vi.fn()}
          onRoleSwitch={vi.fn()}
          previewWidth={320}
        >
          <div>Settings</div>
        </NavigationShell>,
      );
      expect(root.style.getPropertyValue(property)).toBe('0.9');
      view.unmount();
      expect(root.style.getPropertyValue(property)).toBe('0.84');
      expect(root.style.getPropertyPriority(property)).toBe('important');
    } finally {
      root.style.removeProperty(property);
    }
  });

});
