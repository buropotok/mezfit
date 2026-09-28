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

function scene(container: HTMLElement): HTMLElement {
  const result = container.firstElementChild?.firstElementChild;
  if (!(result instanceof HTMLElement)) throw new Error('Missing visible scene');
  return result;
}

function realTabsHost(container: HTMLElement): HTMLElement {
  const result = container.querySelector<HTMLElement>('[data-liquid-glass-tabs-no-fab-real]');
  if (!result) throw new Error('Missing canonical tabs host');
  return result;
}

function startupRoot(container: HTMLElement): ShadowRoot {
  const result = scene(container).children[1]?.shadowRoot;
  if (!result) throw new Error('Missing startup shadow root');
  return result;
}

function tab(container: HTMLElement, index: number): HTMLElement {
  const result = container.querySelectorAll<HTMLElement>('[role="tab"]')[index];
  if (!result) throw new Error('Missing tab');
  return result;
}

beforeEach(() => {
  vi.useFakeTimers();
  changed.mockClear();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 16));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal('MutationObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function(this: HTMLElement) {
    if (this.getAttribute('role') === 'tab') return 70;
    return 354;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function(this: HTMLElement) {
    if (this.getAttribute('role') !== 'tab') return 0;
    return Number(this.getAttribute('data-ui-tab-value') ?? 0) * 70;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: vi.fn(() => ({ cancel: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('LiquidGlassTabsNoFab', () => {
  it('unmounts both canonical tabs and startup optics while hidden', () => {
    const view = render(ui(true));
    expect(view.container.firstElementChild?.hasAttribute('hidden')).toBe(true);
    expect(view.container.firstElementChild?.childElementCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the canonical liquidGlass icon Tabs primitive for the settled control', () => {
    const view = render(ui());
    const root = view.container.querySelector<HTMLElement>('[data-ui-theme="liquidGlass"][data-ui-mode="icon"]');
    expect(root).not.toBeNull();
    expect(view.container.querySelectorAll('[role="tab"]')).toHaveLength(5);
    expect(tab(view.container, 0).getAttribute('data-state')).toBe('active');
    expect(realTabsHost(view.container).style.opacity).toBe('1');
    expect(view.container.querySelector('[data-art="2-filled"]')).not.toBeNull();
  });

  it('keeps startup icons sharp while applying the tuned blur to the masked backdrop', () => {
    const view = render(ui(true));
    view.rerender(ui(false));
    const root = startupRoot(view.container);
    const iconFilter = root.getElementById('startup-refraction-icons');

    expect(iconFilter?.querySelector('feGaussianBlur')).toBeNull();
    expect(root.getElementById('startup-lens-saturation')?.getAttribute('values')).toBe('1.29');
    expect((root.getElementById('startup-backdrop-layer') as HTMLElement | null)?.style.backdropFilter).toContain('blur(0.7px)');
    expect(Number(root.getElementById('startup-material-surface')?.getAttribute('fill-opacity'))).toBeCloseTo(.032, 3);
  });

  it('plays the center-spread entrance and hands interaction to the canonical Tabs', () => {
    const view = render(ui(true));
    view.rerender(ui(false));

    const host = realTabsHost(view.container);
    const startup = startupRoot(view.container).getElementById('startupScene') as SVGElement;

    expect(host.style.opacity).toBe('0');
    expect(host.style.pointerEvents).toBe('none');
    expect(host.inert).toBe(true);
    expect(startup.style.visibility).toBe('visible');

    act(() => vi.advanceTimersByTime(940));

    expect(host.style.opacity).toBe('1');
    expect(host.style.pointerEvents).toBe('auto');
    expect(host.inert).toBe(false);
    expect(startup.style.visibility).toBe('hidden');
  });

  it('keeps selection controlled by React after handoff', () => {
    const view = render(ui());

    fireEvent.click(tab(view.container, 3));
    expect(changed).toHaveBeenCalledExactlyOnceWith('3');

    view.rerender(ui(false, '3'));
    expect(tab(view.container, 3).getAttribute('data-state')).toBe('active');
    expect(tab(view.container, 0).getAttribute('data-state')).toBe('inactive');
  });

  it('keeps instances isolated and cleans up entrance RAF work under StrictMode', () => {
    const view = render(<StrictMode>{ui(true)}{ui(true)}</StrictMode>);
    view.rerender(<StrictMode>{ui(false)}{ui(false)}</StrictMode>);

    const hosts = view.container.querySelectorAll<HTMLElement>('[data-liquid-glass-tabs-no-fab-real]');
    expect(hosts).toHaveLength(2);
    expect(hosts[0]).not.toBe(hosts[1]);

    act(() => vi.advanceTimersByTime(80));
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
