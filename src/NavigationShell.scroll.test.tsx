/** @vitest-environment jsdom */
import { useState } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigationShell, useNavigationBackTransition, type NavigationContext } from './NavigationShell';

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

describe('NavigationShell page scroll ownership', () => {
  it('resets the shared page scroller on forward destination changes', () => {
    const view = render(
      <NavigationShell
        me={me}
        activeRole="client"
        destination="today"
        context={null}
        onDestinationChange={vi.fn()}
        onRoleSwitch={vi.fn()}
      >
        <div>Today</div>
      </NavigationShell>,
    );
    const content = view.container.querySelector<HTMLElement>('.navigation-content');
    if (!content) throw new Error('Missing navigation content scroller');

    content.scrollTop = 180;
    fireEvent.scroll(content);
    view.rerender(
      <NavigationShell
        me={me}
        activeRole="client"
        destination="programs"
        context={null}
        onDestinationChange={vi.fn()}
        onRoleSwitch={vi.fn()}
      >
        <div>Programs</div>
      </NavigationShell>,
    );

    expect(content.scrollTop).toBe(0);
  });

  it('restores the previous page offset when nested navigation returns through Back', () => {
    function Harness() {
      const [context, setContext] = useState<NavigationContext | null>(null);
      return (
        <>
          <button
            type="button"
            onClick={() => setContext({ title: 'Детали', onBack: () => setContext(null) })}
          >
            Open detail
          </button>
          <NavigationShell
            me={me}
            activeRole="client"
            destination="today"
            context={context}
            onDestinationChange={vi.fn()}
            onRoleSwitch={vi.fn()}
          >
            <div>{context ? 'Detail' : 'Today'}</div>
          </NavigationShell>
        </>
      );
    }

    const view = render(<Harness />);
    const content = view.container.querySelector<HTMLElement>('.navigation-content');
    if (!content) throw new Error('Missing navigation content scroller');

    content.scrollTop = 140;
    fireEvent.scroll(content);
    fireEvent.click(view.getByRole('button', { name: 'Open detail' }));
    expect(content.scrollTop).toBe(0);

    content.scrollTop = 60;
    fireEvent.scroll(content);
    fireEvent(window, new PopStateEvent('popstate'));

    expect(content.scrollTop).toBe(140);
  });

  it('restores the parent offset when a nested surface closes directly', () => {
    function DirectClose({ onClose }: { onClose: () => void }) {
      const requestBackTransition = useNavigationBackTransition();
      return <button type="button" onClick={() => requestBackTransition(onClose)}>Close detail</button>;
    }

    function Harness() {
      const [context, setContext] = useState<NavigationContext | null>(null);
      return (
        <NavigationShell
          me={me}
          activeRole="client"
          destination="today"
          context={context}
          onDestinationChange={vi.fn()}
          onRoleSwitch={vi.fn()}
        >
          {context ? (
            <DirectClose onClose={() => setContext(null)} />
          ) : (
            <button type="button" onClick={() => setContext({ title: 'Детали', scrollKey: 'detail' })}>
              Open detail
            </button>
          )}
        </NavigationShell>
      );
    }

    const view = render(<Harness />);
    const content = view.container.querySelector<HTMLElement>('.navigation-content');
    if (!content) throw new Error('Missing navigation content scroller');

    content.scrollTop = 140;
    fireEvent.scroll(content);
    fireEvent.click(view.getByRole('button', { name: 'Open detail' }));
    expect(content.scrollTop).toBe(0);

    content.scrollTop = 60;
    fireEvent.scroll(content);
    fireEvent.click(view.getByRole('button', { name: 'Close detail' }));

    expect(content.scrollTop).toBe(140);
  });
});
