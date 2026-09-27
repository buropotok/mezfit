/** @vitest-environment jsdom */
import { StrictMode, useState } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiquidGlassTextOnly, type LiquidGlassTextOnlyTab } from './LiquidGlassTextOnly';
import prototypeCss from './liquid-glass-text-only/prototype.css?inline';

const tabs: LiquidGlassTextOnlyTab[] = [
  { value: 'today', label: 'Сегодня' },
  { value: 'clients', label: 'Клиенты' },
  { value: 'programs', label: 'Программы' },
  { value: 'analytics', label: 'Аналитика' },
  { value: 'workouts', label: 'Тренировки' },
  { value: 'measurements', label: 'Измерения' },
  { value: 'settings', label: 'Настройки' },
];

const widths = new Map([
  ['Сегодня', 78], ['Клиенты', 88], ['Программы', 102], ['Аналитика', 96],
  ['Тренировки', 108], ['Измерения', 98], ['Настройки', 96],
]);
const changed = vi.fn();
const animationCancels: ReturnType<typeof vi.fn>[] = [];
let animateMock: ReturnType<typeof vi.fn>;

function ui(hidden = false, value = 'today', list = tabs) {
  return <LiquidGlassTextOnly hidden={hidden} tabs={list} value={value} onValueChange={changed} />;
}
function Controlled({ initialValue = 'today' }: { initialValue?: string }) {
  const [value, setValue] = useState(initialValue);
  return (
    <LiquidGlassTextOnly
      hidden={false}
      tabs={tabs}
      value={value}
      onValueChange={(next) => {
        changed(next);
        setValue(next);
      }}
    />
  );
}
function getScene(container: HTMLElement): ShadowRoot {
  const host = container.firstElementChild?.firstElementChild;
  if (!host?.shadowRoot) throw new Error('Visible scene must own a shadow root');
  return host.shadowRoot;
}
function element(root: ShadowRoot, id: string): HTMLElement {
  const result = root.getElementById(id);
  if (!(result instanceof HTMLElement)) throw new Error(`Missing ${id}`);
  return result;
}
function button(root: ShadowRoot, index: number): HTMLButtonElement {
  const result = root.querySelectorAll<HTMLButtonElement>('.tab-link')[index];
  if (!result) throw new Error('Missing tab');
  return result;
}
function tabWidth(element: HTMLElement) {
  return widths.get(element.textContent?.trim() ?? '') ?? 84;
}
function tabLeft(element: HTMLElement) {
  let left = 0;
  let sibling = element.previousElementSibling;
  while (sibling) {
    if (sibling instanceof HTMLElement && sibling.classList.contains('tab-link')) left += tabWidth(sibling);
    sibling = sibling.previousElementSibling;
  }
  return left;
}
function translateX(element: HTMLElement) {
  const match = element.style.transform.match(/translateX\(([-\d.]+)px\)/);
  return Number(match?.[1] ?? 0);
}

beforeEach(() => {
  vi.useFakeTimers();
  changed.mockClear();
  animationCancels.length = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'touch';
    }
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function(this: HTMLElement) {
    if (this.classList.contains('tab-link')) return tabWidth(this);
    if (this.id === 'lens' || this.id === 'lens-track') return Number.parseFloat(this.style.width) || 44;
    return 280;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function(this: HTMLElement) {
    if (this.id === 'lens' || this.id === 'lens-track') return Number.parseFloat(this.style.height) || 44;
    return 44;
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function(this: HTMLElement) {
    if (this.id === 'tab-strip' || this.id === 'toolbar-pane') return 280;
    return 390;
  });
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function(this: HTMLElement) {
    if (this.id === 'tab-strip') return tabs.reduce((sum, tab) => sum + (widths.get(tab.label) ?? 84), 0);
    return this.clientWidth;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function(this: HTMLElement) {
    return this.classList.contains('tab-link') ? tabLeft(this) : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    if (this.classList.contains('tab-link')) {
      const width = tabWidth(this), left = tabLeft(this);
      return { x:left, y:0, left, top:0, right:left+width, bottom:44, width, height:44, toJSON:()=>({}) };
    }
    const baseWidth = this.id === 'toolbar-pane' || this.id === 'tab-strip' ? 280 : (Number.parseFloat(this.style.width) || 280);
    const scale = this.id === 'toolbar-pane' ? Number.parseFloat(this.style.scale || '1') || 1 : 1;
    const width = baseWidth * scale;
    return { x:0, y:0, left:0, top:0, right:width, bottom:44, width, height:44, toJSON:()=>({}) };
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  animateMock = vi.fn(() => {
    const cancel = vi.fn();
    animationCancels.push(cancel);
    return { cancel, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  });
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animateMock });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('LiquidGlassTextOnly', () => {
  it('unmounts the private scene while hidden', () => {
    const view = render(ui(true));
    expect(view.container.firstElementChild?.hasAttribute('hidden')).toBe(true);
    expect(view.container.firstElementChild?.childElementCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('renders the approved 44px variable-width Caption structure without reveal/handoff', () => {
    const view = render(ui());
    const root = getScene(view.container);
    expect(root.querySelectorAll('.tab-link')).toHaveLength(7);
    expect(element(root, 'toolbar-pane').getBoundingClientRect().height).toBe(44);
    expect(element(root, 'selector-mask')).not.toBeNull();
    expect(element(root, 'lens-viewport')).not.toBeNull();
    expect(root.getElementById('startupScene')).toBeNull();
    expect(prototypeCss).toContain('font-size: var(--ui-font-size-caption)');
    expect(prototypeCss).toContain('line-height: var(--ui-line-height-caption)');
    expect(prototypeCss).toContain('font-weight: var(--ui-font-weight-medium)');
    expect(prototypeCss).toContain('.selector-mask');
    expect(prototypeCss).toContain('overflow: hidden');
    expect(prototypeCss).toContain('.lens-viewport');
    expect(button(root, 1).offsetWidth).not.toBe(button(root, 2).offsetWidth);
  });

  it('selects on tap and moves scroll + lens in the same travel window', () => {
    const view = render(<Controlled />);
    const root = getScene(view.container);
    const strip = element(root, 'tab-strip');
    const lensTrack = element(root, 'lens-track');
    const initialLensX = translateX(lensTrack);
    fireEvent.click(button(root, 5));
    expect(changed).toHaveBeenCalledExactlyOnceWith('measurements');
    act(() => vi.advanceTimersByTime(160));
    expect(strip.scrollLeft).toBeGreaterThan(0);
    expect(translateX(lensTrack)).not.toBe(initialLensX);
    act(() => vi.advanceTimersByTime(180));
    expect(button(root, 5).getAttribute('aria-selected')).toBe('true');
    const neighbour = button(root, 6);
    expect(neighbour.offsetLeft + neighbour.offsetWidth).toBeLessThanOrEqual(strip.scrollLeft + strip.clientWidth + .5);
  });

  it('starts the spring only after the 300ms arrival phase, including same-slot taps', () => {
    const view = render(ui());
    const root = getScene(view.container);
    fireEvent.click(button(root, 0));
    act(() => vi.advanceTimersByTime(288));
    expect(animateMock).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(32));
    expect(animateMock).toHaveBeenCalledTimes(1);
    const track = element(root, 'lens-track');
    const height = Number.parseFloat(track.style.height);
    expect(height).toBeGreaterThan(44);
    expect(Number.parseFloat(track.style.borderRadius)).toBeCloseTo(height / 2, 3);
  });

  it('uses a 10px swipe threshold and never selects a tab after a horizontal swipe', () => {
    const view = render(ui());
    const root = getScene(view.container);
    const pane = element(root, 'toolbar-pane');
    const strip = element(root, 'tab-strip');
    fireEvent.pointerDown(pane, { pointerId:1, pointerType:'touch', clientX:180, clientY:22 });
    fireEvent.pointerMove(document, { pointerId:1, pointerType:'touch', clientX:176, clientY:22 });
    expect(strip.scrollLeft).toBe(0);
    fireEvent.pointerMove(document, { pointerId:1, pointerType:'touch', clientX:140, clientY:22 });
    expect(strip.scrollLeft).toBeGreaterThan(0);
    fireEvent.pointerUp(document, { pointerId:1, pointerType:'touch', clientX:140, clientY:22 });
    expect(changed).not.toHaveBeenCalled();
  });

  it('clamps manual lens drag to the first slot center', () => {
    const view = render(ui());
    const root = getScene(view.container);
    const pane = element(root, 'toolbar-pane');
    const lensTrack = element(root, 'lens-track');
    fireEvent.pointerDown(pane, { pointerId:2, pointerType:'touch', clientX:39, clientY:22 });
    act(() => vi.advanceTimersByTime(160));
    fireEvent.pointerMove(document, { pointerId:2, pointerType:'touch', clientX:-240, clientY:22 });
    const center = translateX(lensTrack) + Number.parseFloat(lensTrack.style.width) / 2;
    const expected = 140 + (39 - 140) * 1.05;
    expect(center).toBeCloseTo(expected, 1);
    fireEvent.pointerCancel(document, { pointerId:2, pointerType:'touch', clientX:-240, clientY:22 });
  });

  it('follows controlled value changes without notifying the parent again', () => {
    const view = render(ui());
    changed.mockClear();
    view.rerender(ui(false, 'analytics'));
    expect(changed).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(340));
    const root = getScene(view.container);
    expect(button(root, 3).getAttribute('aria-selected')).toBe('true');
  });

  it('isolates instances and disposes pending work under StrictMode', () => {
    const view = render(<StrictMode>{ui()}{ui()}</StrictMode>);
    const first = view.container.children[0].firstElementChild?.shadowRoot;
    const second = view.container.children[1].firstElementChild?.shadowRoot;
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
    if (!first || !second) throw new Error('Missing scenes');
    fireEvent.click(button(first, 1));
    expect(button(second, 0).getAttribute('aria-selected')).toBe('true');
    act(() => vi.advanceTimersByTime(320));
    expect(animationCancels.length).toBeGreaterThan(0);
    view.unmount();
    expect(animationCancels.every(cancel => cancel.mock.calls.length > 0)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
