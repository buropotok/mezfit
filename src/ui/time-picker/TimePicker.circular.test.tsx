// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimePicker } from './TimePicker';

vi.mock('../../telegram', () => ({ triggerTelegramSelectionHaptic: vi.fn() }));

// RequestAnimationFrame runs on the next frame in WebViews, not synchronously.
// An immediate callback stub leaves the picker's frame-id guard permanently set.
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;

function flushFrames() {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(0));
  });
}

function dispatchTouch(element: Element, type: string, y: number, time: number) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, 'timeStamp', { value: time });
  Object.defineProperty(event, type === 'touchend' ? 'changedTouches' : 'touches', {
    value: [{ clientY: y }],
  });
  fireEvent(element, event);
}

function renderWheel(value = '08:00') {
  const target = document.createElement('button');
  document.body.appendChild(target);
  const onChange = vi.fn();
  render(
    <KonstaProvider theme="ios" dark>
      <div className="k-ios dark">
        <TimePicker opened target={target} value={value} onChange={onChange} onClose={() => {}} />
      </div>
    </KonstaProvider>,
  );
  flushFrames();
  return {
    onChange,
    hours: screen.getByRole('listbox', { name: 'Часы' }),
    minutes: screen.getByRole('listbox', { name: 'Минуты' }),
  };
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
  frames.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('cyclic TimePicker wheels', () => {
  it('renders both boundaries continuously and wraps hours and minutes without changing their labels', () => {
    const { hours, minutes, onChange } = renderWheel('23:59');
    expect(within(hours).getByRole('option', { name: '23' }).getAttribute('aria-selected')).toBe('true');
    expect(within(minutes).getByRole('option', { name: '59' }).getAttribute('aria-selected')).toBe('true');

    hours.scrollTop = 72 * 24; // 23 -> 00, middle-to-next cycle
    fireEvent.scroll(hours);
    flushFrames();
    expect(onChange).toHaveBeenLastCalledWith('00:59');
    minutes.scrollTop = 180 * 24; // 59 -> 00, middle-to-next cycle
    fireEvent.scroll(minutes);
    flushFrames();
    expect(onChange).toHaveBeenLastCalledWith('00:00');

    hours.scrollTop = 47 * 24; // 00 -> 23 (previous cycle)
    fireEvent.scroll(hours);
    flushFrames();
    expect(onChange).toHaveBeenLastCalledWith('23:00');
    minutes.scrollTop = 119 * 24; // 00 -> 59 (previous cycle)
    fireEvent.scroll(minutes);
    flushFrames();
    expect(onChange).toHaveBeenLastCalledWith('23:59');
  });

  it.each([10, 32, 53])('keeps every native minute landing after a fast swipe: %i', minute => {
    const { minutes, onChange } = renderWheel('08:01');
    dispatchTouch(minutes, 'touchstart', 230, 100);
    dispatchTouch(minutes, 'touchmove', 100, 200);
    dispatchTouch(minutes, 'touchend', 100, 300);
    const top = (120 + minute) * 24;
    minutes.scrollTop = top;
    fireEvent.scroll(minutes);
    flushFrames();
    expect(onChange).toHaveBeenLastCalledWith(`08:${minute}`);
    expect(minutes.scrollTop).toBe(top);
    expect(within(minutes).getByRole('option', { name: String(minute) })
      .getAttribute('aria-selected')).toBe('true');
  });

  it('never writes the native scroll position while momentum passes through a cycle boundary', () => {
    const { minutes } = renderWheel('08:59');
    let top = 179 * 24;
    const writes: number[] = [];
    Object.defineProperty(minutes, 'scrollTop', {
      configurable: true,
      get: () => top,
      set: (value: number) => { writes.push(value); top = value; },
    });
    for (const row of [180, 181, 190, 290]) {
      top = row * 24;
      fireEvent.scroll(minutes);
      flushFrames();
    }
    expect(writes).toEqual([]);
    expect(top).toBe(290 * 24);
    fireEvent(minutes, new Event('scrollend', { bubbles: true }));
    flushFrames();
    expect(top).toBe(170 * 24);
    expect(writes).toEqual([170 * 24]);
  });

  it('keeps a precise minute after native scrolling takes over the touch', () => {
    const { minutes, onChange } = renderWheel();
    dispatchTouch(minutes, 'touchstart', 230, 100);
    dispatchTouch(minutes, 'touchmove', 100, 180);
    dispatchTouch(minutes, 'touchcancel', 100, 190);
    minutes.scrollTop = (120 + 32) * 24;
    fireEvent.scroll(minutes);
    flushFrames();
    expect(onChange).toHaveBeenLastCalledWith('08:32');
    fireEvent.click(within(minutes).getByRole('option', { name: '12' }));
    expect(onChange).toHaveBeenLastCalledWith('08:12');
  });

  it('flushes the last visible native position when dismissed before the next animation frame', () => {
    const { minutes, onChange } = renderWheel();
    minutes.scrollTop = (120 + 37) * 24;
    fireEvent.scroll(minutes);
    const dialog = screen.getByRole('dialog', { name: 'Выбор времени' });
    fireEvent.click(dialog.previousElementSibling as Element);
    expect(onChange).toHaveBeenLastCalledWith('08:37');
  });

  it('does not emit a duplicate change when native scrolling selects the current value', () => {
    const { minutes, onChange } = renderWheel();
    minutes.scrollTop = 180 * 24;
    fireEvent.scroll(minutes);
    flushFrames();
    expect(onChange).not.toHaveBeenCalled();
  });
});
