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

const namedTabs: LiquidGlassTabsNoFabTab[] = [
  { value: 'today', label: 'Сегодня', icon: 'calendar-event' },
  { value: 'clients', label: 'Клиенты', icon: 'users' },
  { value: 'programs', label: 'Программы', icon: 'clipboard-list' },
  { value: 'analytics', label: 'Аналитика', icon: 'chart-dots-2' },
  { value: 'settings', label: 'Настройки', icon: 'settings' },
];

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
  const result = root.querySelectorAll<HTMLButtonElement>('button')[index];
  if (!result) throw new Error('Missing tab');
  return result;
}

function element(root: ShadowRoot, id: string): HTMLElement {
  const result = root.getElementById(id);
  if (!(result instanceof HTMLElement)) throw new Error('Missing ' + id);
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
  it('renders nothing active while hidden', () => {
    const view = render(ui(true));
    expect(view.container.firstElementChild?.hasAttribute('hidden')).toBe(true);
    expect(view.container.firstElementChild?.childElementCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the same settled private tabs structure as LiquidGlassIconOnly', () => {
    const view = render(ui());
    const root = getScene(view.container);

    expect(root.querySelector('.ui-tabs')).toBeNull();
    expect(root.querySelectorAll('.tab-link')).toHaveLength(5);
    expect(element(root, 'iconMask').classList.contains('tabs-interactive')).toBe(true);
    expect(button(root, 2).getAttribute('aria-label')).toBe('Программы');
    expect(root.querySelector('[data-art="2-filled"]')).not.toBeNull();
    expect(button(root, 0).style.width).toBe('20%');
    expect(root.querySelector('[data-liquid-glass-fab-slot]')).toBeNull();
    expect(view.container.querySelector('[data-liquid-glass-fab-slot]')).toBeNull();
  });

  it('resolves registered icon names through the same icon-only scene', () => {
    const view = render(ui(false, 'today', namedTabs));
    const root = getScene(view.container);
    const outline = root.querySelector<HTMLElement>('.tab-link .tab-icon-outline .ui-icon');
    const filled = root.querySelector<HTMLElement>('.tab-link .tab-icon-filled .ui-icon');

    expect(outline).not.toBeNull();
    expect(filled).not.toBeNull();
    const outlineMask = outline?.style.getPropertyValue('mask-image') ?? '';
    const filledMask = filled?.style.getPropertyValue('mask-image') ?? '';
    expect(outlineMask).toContain('data:image/svg+xml');
    expect(filledMask).toContain('data:image/svg+xml');
    expect(filledMask).not.toBe(outlineMask);
  });

  it('keeps the LiquidGlassIconOnly settled lens variables unchanged', () => {
    const view = render(ui());
    const lens = element(getScene(view.container), 'lens');

    expect(lens.style.getPropertyValue('--sl-glass-tint')).toBe('.17');
    expect(lens.style.getPropertyValue('--sl-backdrop-blur')).toBe('0px');
    expect(lens.style.getPropertyValue('--sl-glass-brightness')).toBe('1.02');
    expect(lens.style.getPropertyValue('--sl-bezel-opacity')).toBe('.86');
  });

  it('uses the approved center-spread reveal material without blurring startup icons', () => {
    const view = render(ui(true));
    view.rerender(ui(false));
    const root = getScene(view.container);
    const iconFilter = root.getElementById('startup-refraction-icons');

    expect(iconFilter?.querySelector('feGaussianBlur')).toBeNull();
    expect(root.getElementById('startup-lens-saturation')?.getAttribute('values')).toBe('1.29');
    expect((root.getElementById('startup-backdrop-layer') as HTMLElement | null)?.style.backdropFilter).toContain('blur(0.7px)');
    expect(Number(root.getElementById('startup-material-surface')?.getAttribute('fill-opacity'))).toBeCloseTo(.032, 3);
    expect(view.container.querySelector('[data-liquid-glass-fab-slot]')).toBeNull();
  });

  it('plays the center-spread reveal and hands off to the same settled icon-only runtime', () => {
    const view = render(ui(true));
    view.rerender(ui(false));
    const root = getScene(view.container);

    expect(element(root, 'iconLayer').hasAttribute('startup')).toBe(true);
    expect(element(root, 'iconMask').classList.contains('tabs-interactive')).toBe(false);

    act(() => vi.advanceTimersByTime(940));

    expect(element(root, 'iconLayer').hasAttribute('startup')).toBe(false);
    expect(element(root, 'iconMask').classList.contains('tabs-interactive')).toBe(true);
    const startup = root.querySelector<SVGSVGElement>('#startupScene');
    if (!startup) throw new Error('Missing startup scene');
    expect(startup.style.visibility).toBe('hidden');
  });

  it('does not replay reveal on controlled selection changes', () => {
    const view = render(ui(true));
    view.rerender(ui(false));
    const root = getScene(view.container);
    act(() => vi.advanceTimersByTime(940));

    const cancelCount = cancels.length;
    view.rerender(ui(false, '2'));

    expect(cancels).toHaveLength(cancelCount);
    expect(button(root, 2).getAttribute('aria-selected')).toBe('true');
  });

  it('requests selection and follows the controlled value exactly like LiquidGlassIconOnly', () => {
    const view = render(ui());
    const root = getScene(view.container);

    fireEvent.click(button(root, 2));
    expect(changed).toHaveBeenCalledExactlyOnceWith('2');
    expect(button(root, 0).getAttribute('aria-selected')).toBe('true');

    view.rerender(ui(false, '4'));
    expect(button(root, 4).getAttribute('aria-selected')).toBe('true');
    expect(element(root, 'selector-track').style.transform).toBe('translateX(312px)');
  });

  it('retains the icon-only hold and drag optics', () => {
    const view = render(ui());
    const root = getScene(view.container);
    const pane = element(root, 'toolbar-pane');

    fireEvent.pointerDown(button(root, 0), { composed: true, pointerId: 1, clientX: 39, clientY: 32, pointerType: 'touch' });
    act(() => vi.advanceTimersByTime(160));
    expect(element(root, 'lens').classList.contains('pressed')).toBe(true);

    fireEvent.pointerMove(pane, { composed: true, pointerId: 1, clientX: 300, clientY: 32, pointerType: 'touch' });
    fireEvent.pointerCancel(pane, { composed: true, pointerId: 1, clientX: 300, clientY: 32, pointerType: 'touch' });
    expect(changed).not.toHaveBeenCalled();
  });

  it('cancels animation work on hide and can replay on a later show', () => {
    const view = render(ui(true));
    view.rerender(ui(false));
    act(() => vi.advanceTimersByTime(100));

    view.rerender(ui(true));
    expect(vi.getTimerCount()).toBe(0);
    expect(cancels.every(cancel => cancel.mock.calls.length > 0)).toBe(true);

    view.rerender(ui(false));
    expect(element(getScene(view.container), 'iconLayer').hasAttribute('startup')).toBe(true);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('isolates instances and cleans up under StrictMode', () => {
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
    expect(vi.getTimerCount()).toBe(0);
  });
});
