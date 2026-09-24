/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiquidGlassIconOnly, type LiquidGlassIconOnlyTab } from './LiquidGlassIconOnly';

const icon = (name: string) => ({
  outline: <span data-icon={`${name}-outline`} />,
  filled: <span data-icon={`${name}-filled`} />,
});

const fiveTabs: LiquidGlassIconOnlyTab[] = [
  { value: 'today', label: 'Сегодня', icon: icon('today') },
  { value: 'clients', label: 'Клиенты', icon: icon('clients') },
  { value: 'programs', label: 'Программы', icon: icon('programs') },
  { value: 'analytics', label: 'Аналитика', icon: icon('analytics') },
  { value: 'settings', label: 'Настройки', icon: icon('settings') },
];

class ResizeObserverMock {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: vi.fn(() => ({ cancel: vi.fn(), addEventListener: vi.fn() })),
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: vi.fn(() => null),
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('LiquidGlassIconOnly', () => {
  it('is an independent primitive with exactly the supplied tabs and equal slots', () => {
    const { container } = render(
      <LiquidGlassIconOnly tabs={fiveTabs} value="programs" onValueChange={() => {}} hidden={false} />,
    );

    const root = container.querySelector('.ui-liquid-glass-icon-only');
    const tabs = [...container.querySelectorAll<HTMLElement>('.ui-liquid-glass-icon-only__tab')];

    expect(root).not.toBeNull();
    expect(container.querySelector('.ui-tabs')).toBeNull();
    expect(tabs).toHaveLength(5);
    expect(tabs.every((tab) => tab.style.width === '20%' && tab.style.flexBasis === '20%')).toBe(true);
    expect(tabs.map((tab) => tab.getAttribute('aria-label'))).toEqual([
      'Сегодня', 'Клиенты', 'Программы', 'Аналитика', 'Настройки',
    ]);
    expect(tabs[2].getAttribute('aria-selected')).toBe('true');
  });

  it('derives slot width from tabs.length instead of a fixed tab count', () => {
    const { container } = render(
      <LiquidGlassIconOnly tabs={fiveTabs.slice(0, 4)} value="today" onValueChange={() => {}} hidden={false} />,
    );

    const tabs = [...container.querySelectorAll<HTMLElement>('.ui-liquid-glass-icon-only__tab')];
    expect(tabs).toHaveLength(4);
    expect(tabs.every((tab) => tab.style.width === '25%' && tab.style.flexBasis === '25%')).toBe(true);
  });

  it('is fully hidden while hidden=true and only starts reveal on true to false', () => {
    const { container, rerender } = render(
      <LiquidGlassIconOnly tabs={fiveTabs} value="today" onValueChange={() => {}} hidden />,
    );
    const root = container.querySelector<HTMLElement>('.ui-liquid-glass-icon-only');

    expect(root?.dataset.phase).toBe('hidden');
    expect(root?.getAttribute('aria-hidden')).toBe('true');

    rerender(<LiquidGlassIconOnly tabs={fiveTabs} value="today" onValueChange={() => {}} hidden={false} />);
    expect(root?.dataset.phase).toBe('revealing');

    rerender(<LiquidGlassIconOnly tabs={fiveTabs} value="today" onValueChange={() => {}} hidden />);
    expect(root?.dataset.phase).toBe('hidden');
  });

  it('mounts directly in the final state when hidden=false', () => {
    const { container } = render(
      <LiquidGlassIconOnly tabs={fiveTabs} value="today" onValueChange={() => {}} hidden={false} />,
    );

    expect(container.querySelector<HTMLElement>('.ui-liquid-glass-icon-only')?.dataset.phase).toBe('visible');
  });

  it('emits the supplied value when a tab is selected', () => {
    const onValueChange = vi.fn();
    const { container } = render(
      <LiquidGlassIconOnly tabs={fiveTabs} value="today" onValueChange={onValueChange} hidden={false} />,
    );

    const tabs = [...container.querySelectorAll<HTMLButtonElement>('.ui-liquid-glass-icon-only__tab')];
    fireEvent.click(tabs[3]);

    expect(onValueChange).toHaveBeenCalledWith('analytics');
  });

  it('activates the prototype hold lens, glass highlight and 1.05 container scale after 140ms', () => {
    const { container } = render(
      <LiquidGlassIconOnly tabs={fiveTabs} value="today" onValueChange={() => {}} hidden={false} />,
    );
    const pane = container.querySelector<HTMLElement>('.ui-liquid-glass-icon-only__pane');
    const lens = container.querySelector<HTMLElement>('.ui-liquid-glass-icon-only__lens');
    if (!pane) throw new Error('pane missing');

    pane.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, right: 354, bottom: 64, width: 354, height: 64, toJSON: () => ({}),
    });

    fireEvent.pointerDown(pane, {
      pointerId: 7,
      pointerType: 'touch',
      clientX: 35,
      clientY: 32,
    });
    vi.advanceTimersByTime(140);

    expect(lens?.classList.contains('pressed')).toBe(true);
    expect(pane.style.scale).toBe('1.05');
    expect(pane.querySelector('.ui-liquid-glass-icon-only__glass-light-wrap')).not.toBeNull();
  });
});