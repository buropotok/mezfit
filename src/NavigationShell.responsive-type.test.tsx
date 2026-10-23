/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
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

beforeEach(() => {
  width = 320;
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
    expect(document.documentElement.style.getPropertyValue('--ui-font-size-headline')).toBe('');
  });
});
