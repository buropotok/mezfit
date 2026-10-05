/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavbarMetaball } from './NavbarMetaball';
import { NAVBAR_METABALL } from './navbarMetaballGeometry';

let now = 0;
let sequence = 0;
let frames = new Map<number, FrameRequestCallback>();

function advance(ms: number) {
  now += ms;
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach(callback => callback(now));
}

beforeEach(() => {
  now = 0;
  sequence = 0;
  frames = new Map();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++sequence;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function(this: HTMLElement) {
    return this.classList.contains('ui-navbar-metaball') ? 390 : 44;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('NavbarMetaball', () => {
  it('keeps Back fully transparent under the identity, then morphs to two settled glass surfaces', () => {
    const view = render(
      <NavbarMetaball
        level={1}
        identity={{ title: 'Сегодня', icon: 'calendar-event' }}
        onBack={vi.fn()}
      />,
    );

    const backSlot = view.container.querySelector<HTMLElement>('.ui-navbar-metaball__back-slot');
    expect(backSlot?.style.opacity).toBe('0');
    expect(view.container.querySelectorAll('.ui-navbar-metaball__surface')).toHaveLength(1);

    view.rerender(
      <NavbarMetaball
        level={2}
        identity={{ title: 'Клиент', avatar: { name: 'Клиент' } }}
        onBack={vi.fn()}
      />,
    );

    expect(view.container.querySelector('.ui-glass-surface.ui-navbar-metaball__liquid')).toBeNull();
    expect(backSlot?.style.opacity).toBe('0');

    act(() => advance(0));
    act(() => advance(1));
    expect(view.container.querySelector('.ui-glass-surface.ui-navbar-metaball__liquid')).not.toBeNull();
    act(() => advance(NAVBAR_METABALL.duration - 1));

    expect(view.container.querySelector('.ui-glass-surface.ui-navbar-metaball__liquid')).toBeNull();
    expect(view.container.querySelectorAll('.ui-navbar-metaball__surface')).toHaveLength(2);
    expect(backSlot?.style.left).toBe('0px');
    expect(backSlot?.style.opacity).toBe('1');
  });

  it('uses the same 450ms timeline when returning Back into the identity', () => {
    const view = render(
      <NavbarMetaball
        level={2}
        identity={{ title: 'Клиент', avatar: { name: 'Клиент' } }}
        onBack={vi.fn()}
      />,
    );

    view.rerender(
      <NavbarMetaball
        level={1}
        identity={{ title: 'Сегодня', icon: 'calendar-event' }}
        onBack={vi.fn()}
      />,
    );

    act(() => advance(0));
    act(() => advance(1));
    expect(view.container.querySelector('.ui-navbar-metaball')?.getAttribute('data-moving')).toBe('true');

    act(() => advance(NAVBAR_METABALL.duration - 2));
    expect(view.container.querySelector('.ui-navbar-metaball')?.getAttribute('data-moving')).toBe('true');

    act(() => advance(1));
    expect(view.container.querySelector('.ui-navbar-metaball')?.hasAttribute('data-moving')).toBe(false);
    expect(view.container.querySelectorAll('.ui-navbar-metaball__surface')).toHaveLength(1);
    expect(view.container.querySelector<HTMLElement>('.ui-navbar-metaball__back-slot')?.style.opacity).toBe('0');
  });

  it('preserves the existing delayed Back activation contract', () => {
    const onBack = vi.fn();
    const view = render(
      <NavbarMetaball
        level={2}
        identity={{ title: 'Клиент', avatar: { name: 'Клиент' } }}
        onBack={onBack}
      />,
    );
    const back = view.getByRole('button', { name: 'Назад' });

    fireEvent.pointerDown(back, { pointerType: 'touch', button: 0 });
    fireEvent.click(back);

    expect(back.classList.contains('ui-identity-action--animating')).toBe(true);
    expect(view.container.querySelector('.ui-navbar-metaball__surface--back')?.classList.contains('ui-identity-action--animating')).toBe(true);
    expect(onBack).not.toHaveBeenCalled();

    fireEvent.animationEnd(back);

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
