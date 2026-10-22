/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
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
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('NavigationShell 320px window', () => {
  it('constrains the full shell and keeps all UI kit primitives unchanged', () => {
    const common = {
      me,
      activeRole: 'client' as const,
      destination: 'settings' as const,
      context: null,
      onDestinationChange: vi.fn(),
      onRoleSwitch: vi.fn(),
    };
    const view = render(
      <NavigationShell {...common} previewWidth={320}>
        <div>Settings content</div>
      </NavigationShell>,
    );

    const shell = view.container.querySelector<HTMLElement>('.navigation-shell');
    expect(shell?.classList.contains('navigation-shell--windowed')).toBe(true);
    expect(shell?.getAttribute('data-preview-width')).toBe('320');
    expect(shell?.querySelector('.navigation-primary-tabs')).toBeTruthy();
    expect(shell?.querySelector('.navigation-navbar-frame')).toBeTruthy();
    expect(shell?.querySelector('.navigation-content')).toBeTruthy();

    view.rerender(
      <NavigationShell {...common} previewWidth={null}>
        <div>Settings content</div>
      </NavigationShell>,
    );
    expect(shell?.classList.contains('navigation-shell--windowed')).toBe(false);
    expect(shell?.hasAttribute('data-preview-width')).toBe(false);
  });
});
