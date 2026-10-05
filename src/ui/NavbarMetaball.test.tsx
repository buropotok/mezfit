/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavbarMetaball } from './NavbarMetaball';
import { NAVBAR_METABALL } from './navbarMetaballGeometry';

let now = 0;
let sequence = 0;
let frames = new Map<number, FrameRequestCallback>();
let width = 390;
const observers: ResizeObserverCallback[] = [];

function advance(ms: number) {
  now += ms;
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach(callback => callback(now));
}

beforeEach(() => {
  now = 0;
  sequence = 0;
  width = 390;
  frames = new Map();
  observers.length = 0;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { observers.push(callback); }
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++sequence;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function(this: HTMLElement) {
    if (this.classList.contains('ui-navbar-metaball')) return width;
    const declared = Number.parseFloat(this.style.width);
    return Number.isFinite(declared) ? declared : 44;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('NavbarMetaball', () => {
  it('parks an invisible Back under the identity and hands moving glass to one liquid contour', () => {
    const view = render(
      <NavbarMetaball
        level={1}
        identity={{ title: 'Сегодня', icon: 'calendar-event' }}
        onBack={vi.fn()}
        glassPreset="frosted"
      />,
    );

    const backSlot = view.container.querySelector<HTMLElement>('.ui-navbar-metaball__back-slot');
    const backSurface = view.container.querySelector<HTMLElement>('.ui-navbar-metaball__back-slot .ui-identity-action');
    const initialIdentitySurface = view.container.querySelector<HTMLElement>('.ui-navbar-metaball__identity-slot .ui-identity-action');
    const identityBezel = initialIdentitySurface?.style.getPropertyValue('--ui-glass-surface-bezel');
    expect(backSlot?.style.left).toBe('61px');
    expect(backSlot?.style.opacity).toBe('0');
    expect(backSlot?.style.visibility).toBe('hidden');
    expect(view.container.querySelector('.ui-navbar-metaball__liquid.ui-glass-surface')).toBeNull();
    expect(backSurface?.style.getPropertyValue('--ui-glass-surface-tint-a')).not.toBe('0');

    view.rerender(
      <NavbarMetaball
        level={2}
        identity={{ title: 'Клиент', avatar: { name: 'Клиент' } }}
        onBack={vi.fn()}
        glassPreset="frosted"
      />,
    );

    const liquid = view.container.querySelector('.ui-navbar-metaball__liquid.ui-glass-surface');
    const identitySurface = view.container.querySelector<HTMLElement>('.ui-navbar-metaball__identity-slot .ui-identity-action');
    expect(liquid).not.toBeNull();
    expect(backSlot?.style.opacity).toBe('0');
    expect(backSlot?.style.visibility).toBe('visible');
    expect(identitySurface?.style.getPropertyValue('--ui-glass-surface-tint-a')).toBe('0');
    expect(identitySurface?.style.getPropertyValue('--ui-glass-surface-bezel')).toBe(identityBezel);
    expect(backSurface?.style.getPropertyValue('--ui-glass-surface-tint-a')).toBe('0');

    act(() => advance(0));
    act(() => advance(NAVBAR_METABALL.duration));

    expect(view.container.querySelector('.ui-navbar-metaball__liquid.ui-glass-surface')).toBeNull();
    expect(backSlot?.style.left).toBe('0px');
    expect(backSlot?.style.opacity).toBe('1');
    expect(backSlot?.style.visibility).toBe('visible');
    expect(identitySurface?.style.getPropertyValue('--ui-glass-surface-tint-a')).not.toBe('0');
    expect(backSurface?.style.getPropertyValue('--ui-glass-surface-tint-a')).not.toBe('0');
  });

  it('keeps forward and reverse speed identical, including a mid-flight reversal', () => {
    const view = render(
      <NavbarMetaball
        level={1}
        identity={{ title: 'Сегодня', icon: 'calendar-event' }}
        onBack={vi.fn()}
      />,
    );

    view.rerender(
      <NavbarMetaball
        level={2}
        identity={{ title: 'Клиент', avatar: { name: 'Клиент' } }}
        onBack={vi.fn()}
      />,
    );
    act(() => advance(0));
    act(() => advance(NAVBAR_METABALL.duration / 2));
    expect(view.container.querySelector('.ui-navbar-metaball')?.getAttribute('data-moving')).toBe('true');

    view.rerender(
      <NavbarMetaball
        level={1}
        identity={{ title: 'Сегодня', icon: 'calendar-event' }}
        onBack={vi.fn()}
      />,
    );
    act(() => advance(0));
    act(() => advance(NAVBAR_METABALL.duration / 2 - 1));
    expect(view.container.querySelector('.ui-navbar-metaball')?.getAttribute('data-moving')).toBe('true');

    act(() => advance(1));
    expect(view.container.querySelector('.ui-navbar-metaball')?.hasAttribute('data-moving')).toBe(false);
    const backSlot = view.container.querySelector<HTMLElement>('.ui-navbar-metaball__back-slot');
    expect(backSlot?.style.opacity).toBe('0');
    expect(backSlot?.style.visibility).toBe('hidden');
  });

  it('responds to navbar width changes like the updated FAB responds to measured content', () => {
    const view = render(
      <NavbarMetaball
        level={1}
        identity={{ title: 'Сегодня', icon: 'calendar-event' }}
        onBack={vi.fn()}
      />,
    );
    const identitySlot = view.container.querySelector<HTMLElement>('.ui-navbar-metaball__identity-slot');
    expect(identitySlot?.style.width).toBe('224px');

    width = 320;
    act(() => observers.forEach(callback => callback([], {} as ResizeObserver)));

    expect(identitySlot?.style.width).toBe('156px');
    expect(view.container.querySelector<HTMLElement>('.ui-navbar-metaball__back-slot')?.style.left).toBe('60px');
  });

  it('preserves the existing delayed Back activation contract through IdentityAction', () => {
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
    expect(onBack).not.toHaveBeenCalled();

    fireEvent.animationEnd(back);

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('releases animation frames on unmount', () => {
    const view = render(
      <NavbarMetaball
        level={1}
        identity={{ title: 'Сегодня', icon: 'calendar-event' }}
        onBack={vi.fn()}
      />,
    );
    view.rerender(
      <NavbarMetaball
        level={2}
        identity={{ title: 'Клиент', avatar: { name: 'Клиент' } }}
        onBack={vi.fn()}
      />,
    );
    expect(frames.size).toBeGreaterThan(0);
    view.unmount();
    expect(frames.size).toBe(0);
  });
});
