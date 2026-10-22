/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigationShell } from './NavigationShell';

vi.mock('./client/ClientCoachSelectorModal', () => ({ ClientCoachSelectorModal: () => null }));

const me = {
  user: {
    id: 1, telegramUserId: '1', username: null,
    firstName: 'Test', lastName: null, languageCode: 'ru',
    photoUrl: null, isPremium: false,
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

describe('NavigationShell responsive tab scale', () => {
  it('uses the shell width (including a 320px window) instead of window.innerWidth', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('navigation-shell') ? 320 : 0;
    });
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
    const nav = view.container.querySelector<HTMLElement>('.navigation-primary-tabs');
    expect(nav?.style.height).toBe('44px');
    const sceneWrapper = nav?.firstElementChild as HTMLElement;
    expect(sceneWrapper.style.transform).toBe('scale(0.6875)');
  });
});
