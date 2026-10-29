// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimePicker, type LocalTime } from './TimePicker';

const ROW_HEIGHT = 24;
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;

function flushFrames() {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(0));
  });
}

function mount(value: LocalTime = '08:00') {
  const target = document.createElement('button');
  document.body.appendChild(target);
  const onChange = vi.fn();
  const view = (time: LocalTime) => (
    <KonstaProvider theme="ios" dark>
      <div className="k-ios dark">
        <TimePicker opened target={target} value={time}
          onChange={onChange} onClose={vi.fn()} />
      </div>
    </KonstaProvider>
  );
  const wrapper = render(view(value));
  return {
    onChange,
    rerender: (next: LocalTime) => wrapper.rerender(view(next)),
    hours: screen.getByRole('listbox', { name: 'Часы' }) as HTMLDivElement,
    minutes: screen.getByRole('listbox', { name: 'Минуты' }) as HTMLDivElement,
  };
}

function trackBrowserScroll(element: HTMLDivElement, initialRow: number) {
  let position = initialRow * ROW_HEIGHT;
  const writes: number[] = [];
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => position,
    set: (next: number) => { writes.push(next); position = next; },
  });
  Object.defineProperty(element, 'scrollTo', {
    configurable: true,
    value: ({ top }: { top: number }) => { element.scrollTop = top; },
  });
  return {
    writes,
    move(row: number) {
      position = row * ROW_HEIGHT;
      fireEvent.scroll(element);
    },
    get position() { return position; },
  };
}

function touch(element: Element, name: string, y: number) {
  const event = new Event(name, { bubbles: true });
  Object.defineProperty(event, name === 'touchend' || name === 'touchcancel' ? 'changedTouches' : 'touches', {
    value: [{ clientY: y }],
  });
  fireEvent(element, event);
}

beforeEach(() => {
  frames.clear();
  nextFrame = 0;
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('TimePicker native momentum ownership', () => {
  it('never recenters a circular wheel during a 200ms gap between momentum events', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { hours } = mount();
    flushFrames();
    Object.defineProperty(hours, 'onscrollend', { configurable: true, value: undefined });
    const native = trackBrowserScroll(hours, 56);

    act(() => native.move(82));
    flushFrames();
    act(() => vi.advanceTimersByTime(200));
    flushFrames();
    expect(native.writes).toEqual([]);

    act(() => native.move(83));
    flushFrames();
    expect(native.writes).toEqual([]);
    expect(native.position).toBe(83 * ROW_HEIGHT);

    // The browser, not the inactivity timer, owns the final aligned position.
    fireEvent(hours, new Event('scrollend', { bubbles: true }));
    flushFrames();
    expect(native.writes).toEqual([59 * ROW_HEIGHT]);
  });

  it('recenters on the next touch, not on a legacy WebView scroll inactivity timeout', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { hours } = mount();
    flushFrames();
    Object.defineProperty(hours, 'onscrollend', { configurable: true, value: undefined });
    const native = trackBrowserScroll(hours, 56);

    act(() => native.move(82));
    flushFrames();
    act(() => vi.advanceTimersByTime(500));
    flushFrames();
    expect(native.writes).toEqual([]);

    touch(hours, 'touchstart', 220);
    expect(native.writes).toEqual([58 * ROW_HEIGHT]);
    expect(native.position).toBe(58 * ROW_HEIGHT);
    touch(hours, 'touchend', 220);
  });

  it('ignores a synthetic button click following a touch flick', () => {
    const { minutes, onChange } = mount();
    flushFrames();
    const native = trackBrowserScroll(minutes, 120);
    touch(minutes, 'touchstart', 220);
    touch(minutes, 'touchmove', 100);
    touch(minutes, 'touchcancel', 100);

    act(() => native.move(132));
    flushFrames();
    expect(onChange).toHaveBeenLastCalledWith('08:12');
    const calls = onChange.mock.calls.length;
    fireEvent.click(within(minutes).getByRole('option', { name: '30' }), { detail: 1 });
    flushFrames();
    expect(onChange).toHaveBeenCalledTimes(calls);
    expect(native.writes).toEqual([]);
    expect(native.position).toBe(132 * ROW_HEIGHT);
  });

  it('still accepts a deliberate tap after recentering a previous touch gesture', () => {
    const { hours, onChange } = mount();
    flushFrames();
    const native = trackBrowserScroll(hours, 56);
    act(() => native.move(82));
    flushFrames();

    touch(hours, 'touchstart', 220);
    expect(native.position).toBe(58 * ROW_HEIGHT);
    fireEvent.scroll(hours); // WebView may dispatch this after the scrollTo at touchstart.
    flushFrames();
    touch(hours, 'touchend', 220);

    fireEvent.click(within(hours).getByRole('option', { name: '05' }), { detail: 1 });
    flushFrames();
    expect(onChange).toHaveBeenLastCalledWith('05:00');
  });

  it('cancels the delayed opening scroll sync if native scrolling starts first', () => {
    const { hours, onChange } = mount();
    const native = trackBrowserScroll(hours, 56);
    act(() => native.move(59));
    flushFrames();
    expect(onChange).toHaveBeenLastCalledWith('11:00');
    expect(native.writes).toEqual([]);
    expect(native.position).toBe(59 * ROW_HEIGHT);
  });

  it('does not steer a moving wheel when an earlier parent value arrives late', () => {
    const { minutes, rerender, onChange } = mount();
    flushFrames();
    const native = trackBrowserScroll(minutes, 120);
    for (const row of [129, 130, 131]) {
      act(() => native.move(row));
      flushFrames();
    }
    expect(onChange).toHaveBeenLastCalledWith('08:11');
    rerender('08:09');
    flushFrames();
    expect(native.writes).toEqual([]);
    act(() => native.move(132));
    flushFrames();
    expect(onChange).toHaveBeenLastCalledWith('08:12');
    expect(native.writes).toEqual([]);
  });

  it('defers an unrelated external controlled change until genuine scrollend', () => {
    const { minutes, rerender } = mount();
    flushFrames();
    const native = trackBrowserScroll(minutes, 120);
    act(() => native.move(132));
    flushFrames();
    rerender('08:45');
    flushFrames();
    expect(native.writes).toEqual([]);

    fireEvent(minutes, new Event('scrollend', { bubbles: true }));
    flushFrames();
    expect(native.writes).toEqual([165 * ROW_HEIGHT]);
  });
});
