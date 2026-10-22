/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiquidGlassIconOnly, type LiquidGlassIconOnlyTab } from '../LiquidGlassIconOnly';

const tabs: LiquidGlassIconOnlyTab[] = ['Сегодня', 'Клиенты', 'Программы', 'Аналитика', 'Настройки']
  .map((label, index) => ({
    value: String(index),
    label,
    icon: { outline: <svg />, filled: <svg /> },
  }));

let visualScale = 1;
const SLOT_WIDTH = 78;
const TAB_WIDTH = SLOT_WIDTH * tabs.length;

beforeEach(() => {
  vi.useFakeTimers();
  visualScale = 1;
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
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(TAB_WIDTH);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
    // Simulate scrollable tab content to cover both native click suppression
    // and the manual touch scroll path, even though the current five icons fit.
    return this.classList.contains('tab-strip') ? TAB_WIDTH + 40 : TAB_WIDTH;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('tab-link') ? SLOT_WIDTH : TAB_WIDTH;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) {
    if (!this.classList.contains('tab-link')) return 0;
    return [...(this.parentElement?.children ?? [])].indexOf(this) * SLOT_WIDTH;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(64);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const isLink = this.classList.contains('tab-link');
    const width = (isLink ? SLOT_WIDTH : TAB_WIDTH) * visualScale;
    const left = (isLink
      ? [...(this.parentElement?.children ?? [])].indexOf(this) * SLOT_WIDTH
      : 0) * visualScale;
    return {
      x: left, y: 0, left, top: 0,
      right: left + width, bottom: 64 * visualScale,
      width, height: 64 * visualScale, toJSON: () => ({}),
    };
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('scaled liquid tab pointer jitter', () => {
  it.each([
    { scale: 1, movement: 3, selected: true },
    { scale: 44 / 64, movement: 3, selected: true },
    { scale: 44 / 64, movement: 5, selected: false },
  ])('handles $movement visual px at scale $scale as a tap=$selected', ({ scale, movement, selected }) => {
    visualScale = scale;
    const onValueChange = vi.fn();
    const view = render(
      <LiquidGlassIconOnly
        tabs={tabs}
        hidden={false}
        value="0"
        onValueChange={onValueChange}
        scale={scale}
      />,
    );
    const host = view.container.firstElementChild?.firstElementChild;
    if (!host?.shadowRoot) throw new Error('Liquid tab ShadowRoot not mounted');
    const root = host.shadowRoot;
    const strip = root.getElementById('tab-strip') as HTMLElement;
    const pane = root.getElementById('toolbar-pane') as HTMLElement;
    const target = root.querySelectorAll<HTMLButtonElement>('.tab-link')[2];
    const startX = 2.5 * SLOT_WIDTH * scale;

    fireEvent.pointerDown(target, {
      composed: true, pointerId: 1, pointerType: 'touch',
      clientX: startX, clientY: 32 * scale,
    });
    fireEvent.pointerMove(pane.ownerDocument, {
      composed: true, pointerId: 1, pointerType: 'touch',
      clientX: startX - movement, clientY: 32 * scale,
    });
    expect(strip.scrollLeft).toBeCloseTo(movement / scale);
    fireEvent.scroll(strip);
    fireEvent(pane, new PointerEvent('pointerup', {
      bubbles: false, composed: true, pointerId: 1, pointerType: 'touch',
      clientX: startX - movement, clientY: 32 * scale,
    }));
    fireEvent.click(target);
    if (selected) {
      expect(onValueChange).toHaveBeenCalledExactlyOnceWith('2');
    } else {
      expect(onValueChange).not.toHaveBeenCalled();
    }
  });
});
