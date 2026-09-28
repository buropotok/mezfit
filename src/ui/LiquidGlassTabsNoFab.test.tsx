/** @vitest-environment jsdom */
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiquidGlassTabsNoFab, type LiquidGlassTabsNoFabTab } from './LiquidGlassTabsNoFab';

const tabs: LiquidGlassTabsNoFabTab[] = ['Сегодня', 'Клиенты', 'Программы', 'Аналитика', 'Настройки'].map((label, index) => ({
  value: String(index),
  label,
  icon: {
    outline: <svg data-art={`${index}-outline`} />,
    filled: <svg data-art={`${index}-filled`} />,
  },
}));

const changed = vi.fn();

function ui(hidden = false, value = '0', list = tabs) {
  return <LiquidGlassTabsNoFab hidden={hidden} tabs={list} value={value} onValueChange={changed} />;
}

function getScene(container: HTMLElement): ShadowRoot {
  const host = container.firstElementChild?.firstElementChild;
  if (!host?.shadowRoot) throw new Error('Visible scene must own a shadow root');
  return host.shadowRoot;
}

function button(root: ShadowRoot, index: number): HTMLButtonElement {
  const result = root.querySelectorAll<HTMLButtonElement>('.tab-link')[index];
  if (!result) throw new Error('Missing tab');
  return result;
}

function element(root: ShadowRoot, id: string): HTMLElement {
  const result = root.getElementById(id);
  if (!(result instanceof HTMLElement)) throw new Error(`Missing ${id}`);
  return result;
}

const cancels: ReturnType<typeof vi.fn>[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  changed.mockClear();
  cancels.length = 0;
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
    const left = Number(this.dataset.index || 0) * 78;
    return { x: left, y: 0, left, top: 0, right: left + width, bottom: 64, width, height: 64, toJSON: () => ({}) };
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: vi.fn(() => {
      const cancel = vi.fn();
      cancels.push(cancel);
      return { cancel, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    }),
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('LiquidGlassTabsNoFab', () => {
  it('renders no private scene or timers while hidden', () => {
    const view = render(ui(true));
    expect(view.container.firstElementChild?.hasAttribute('hidden')).toBe(true);
    expect(view.container.firstElementChild?.childElementCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('settles immediately when first mounted visible', () => {
    const view = render(ui());
    const root = getScene(view.container);
    expect(root.querySelectorAll('.tab-link')).toHaveLength(5);
    expect(element(root, 'iconMask').classList.contains('tabs-interactive')).toBe(true);
    expect(button(root, 0).getAttribute('aria-selected')).toBe('true');
    expect(root.querySelector('[data-art="2-filled"]')).not.toBeNull();
  });

  it('uses the approved sharp-icon startup material', () => {
    const view = render(ui(true));
    view.rerender(ui(false));
    const root = getScene(view.container);
    expect(root.getElementById('startup-lens-blur')).toBeNull();
    expect(root.getElementById('startup-lens-saturation')?.getAttribute('values')).toBe('1.29');
    expect(Number(root.getElementById('startup-material-surface')?.getAttribute('fill-opacity'))).toBeCloseTo(.032, 3);
  });

  it('plays the center-spread reveal once and hands off after the tuned timing', () => {
    const view = render(ui(true));
    view.rerender(ui(false));
    const root = getScene(view.container);
    expect(element(root, 'iconLayer').hasAttribute('startup')).toBe(true);
    expect(element(root, 'iconMask').classList.contains('tabs-interactive')).toBe(false);

    act(() => vi.advanceTimersByTime(1250));

    expect(element(root, 'iconLayer').hasAttribute('startup')).toBe(false);
    expect(element(root, 'iconMask').classList.contains('tabs-interactive')).toBe(true);

    const cancelCount = cancels.length;
    view.rerender(ui(false, '2'));
    expect(cancels).toHaveLength(cancelCount);
    expect(button(root, 2).getAttribute('aria-selected')).toBe('true');
  });

  it('keeps controlled selection and interaction behavior after handoff', () => {
    const view = render(ui());
    const root = getScene(view.container);
    fireEvent.click(button(root, 3));
    expect(changed).toHaveBeenCalledExactlyOnceWith('3');
    expect(button(root, 0).getAttribute('aria-selected')).toBe('true');

    view.rerender(ui(false, '3'));
    expect(button(root, 3).getAttribute('aria-selected')).toBe('true');
    expect(element(root, 'selector-track').style.transform).toBe('translateX(234px)');
  });

  it('isolates instances and disposes animation work under StrictMode', () => {
    const view = render(<StrictMode>{ui()}{ui()}</StrictMode>);
    const first = view.container.children[0].firstElementChild?.shadowRoot;
    const second = view.container.children[1].firstElementChild?.shadowRoot;
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
    if (!first || !second) throw new Error('Missing scenes');

    fireEvent.click(button(first, 1));
    expect(button(second, 0).getAttribute('aria-selected')).toBe('true');

    view.unmount();
    expect(cancels.every(cancel => cancel.mock.calls.length > 0)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
