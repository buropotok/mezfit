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

    hours.scrollTop = 48 * 48; // 23 -> 00
    fireEvent.scroll(hours);
    flushFrames();
    expect(onChange).toHaveBeenLastCalledWith('00:59');
    minutes.scrollTop = 120 * 48; // 59 -> 00
    fireEvent.scroll(minutes);
    flushFrames();
    expect(onChange).toHaveBeenLastCalledWith('00:00');

    hours.scrollTop = 23 * 48; // 00 -> 23 (previous cycle)
    fireEvent.scroll(hours);
    flushFrames();
    expect(onChange).toHaveBeenLastCalledWith('23:00');
    minutes.scrollTop = 59 * 48; // 00 -> 59 (previous cycle)
    fireEvent.scroll(minutes);
    flushFrames();
    expect(onChange).toHaveBeenLastCalledWith('23:59');
  });

  it.each([
    { stoppedAt: 10, expected: '08:15' },
    { stoppedAt: 32, expected: '08:30' },
    { stoppedAt: 53, expected: '08:00' },
  ])('lets native inertia land a fast minute swipe near $stoppedAt on $expected in one motion', ({ stoppedAt, expected }) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    // Use a non-quarter initial minute: a 53 → 00 landing must now
    // emit a real value change rather than returning to the initial 08:00.
    const { minutes, onChange } = renderWheel('08:01');
    dispatchTouch(minutes, 'touchstart', 230, 100);
    dispatchTouch(minutes, 'touchmove', 100, 200);
    expect(minutes.classList.contains('ui-time-picker__column--quarter-snap')).toBe(true);
    expect(within(minutes).getByRole('option', { name: '15' })
      .classList.contains('ui-time-picker__option--quarter-stop')).toBe(true);
    expect(within(minutes).getByRole('option', { name: '10' })
      .classList.contains('ui-time-picker__option--quarter-stop')).toBe(false);
    dispatchTouch(minutes, 'touchend', 100, 300);
    expect(minutes.classList.contains('ui-time-picker__column--quarter-snap')).toBe(true);

    // jsdom has no layout or native CSS scroll snap: simulate the browser's
    // single inertial landing at the quarter target instead of a JS correction.
    const nativeLanding = 60 + Math.round(stoppedAt / 15) * 15;
    minutes.scrollTop = nativeLanding * 48;
    fireEvent.scroll(minutes);
    flushFrames();
    expect(onChange).toHaveBeenLastCalledWith(expected);

    const callsAtLanding = onChange.mock.calls.length;
    act(() => { vi.advanceTimersByTime(400); });
    flushFrames();
    expect(onChange).toHaveBeenCalledTimes(callsAtLanding);
    expect(minutes.scrollTop).toBe(nativeLanding * 48);
  });

  it('does not emit a duplicate change when a native quarter landing equals the current time', () => {
    const { minutes, onChange } = renderWheel('08:00');
    dispatchTouch(minutes, 'touchstart', 230, 100);
    dispatchTouch(minutes, 'touchmove', 100, 200);
    dispatchTouch(minutes, 'touchend', 100, 300);
    expect(minutes.classList.contains('ui-time-picker__column--quarter-snap')).toBe(true);

    // Two scroll cycles render minute 00, which is already the selected value.
    minutes.scrollTop = 120 * 48;
    fireEvent.scroll(minutes);
    flushFrames();
    expect(onChange).not.toHaveBeenCalled();
    expect(within(minutes).getByRole('option', { name: '00' })
      .getAttribute('aria-selected')).toBe('true');
  });

  it('keeps an exact minute during deliberate slow dragging', () => {
    const { minutes, onChange } = renderWheel();
    dispatchTouch(minutes, 'touchstart', 230, 100);
    minutes.scrollTop = (60 + 32) * 48;
    fireEvent.scroll(minutes);
    flushFrames();
    dispatchTouch(minutes, 'touchend', 100, 800);

    flushFrames();
    expect(minutes.classList.contains('ui-time-picker__column--quarter-snap')).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith('08:32');
  });

  it('returns to exact-minute mode on the next touch and on a slow release', () => {
    const { minutes, onChange } = renderWheel();
    dispatchTouch(minutes, 'touchstart', 230, 100);
    dispatchTouch(minutes, 'touchmove', 100, 180);
    expect(minutes.classList.contains('ui-time-picker__column--quarter-snap')).toBe(true);
    dispatchTouch(minutes, 'touchend', 100, 250);

    dispatchTouch(minutes, 'touchstart', 230, 400);
    expect(minutes.classList.contains('ui-time-picker__column--quarter-snap')).toBe(false);
    dispatchTouch(minutes, 'touchmove', 100, 480);
    expect(minutes.classList.contains('ui-time-picker__column--quarter-snap')).toBe(true);
    dispatchTouch(minutes, 'touchend', 100, 1200);
    expect(minutes.classList.contains('ui-time-picker__column--quarter-snap')).toBe(false);

    minutes.scrollTop = (60 + 32) * 48;
    fireEvent.scroll(minutes);
    flushFrames();
    expect(onChange).toHaveBeenLastCalledWith('08:32');
  });

  it('keeps quarter targets if native WebView scrolling cancels the touch', () => {
    const { minutes, onChange } = renderWheel();
    dispatchTouch(minutes, 'touchstart', 230, 100);
    dispatchTouch(minutes, 'touchmove', 100, 180);
    expect(minutes.classList.contains('ui-time-picker__column--quarter-snap')).toBe(true);
    dispatchTouch(minutes, 'touchcancel', 100, 190);
    expect(minutes.classList.contains('ui-time-picker__column--quarter-snap')).toBe(true);

    // Tapping a specific value returns to exact-minute selection.
    fireEvent.click(within(minutes).getByRole('option', { name: '12' }));
    expect(minutes.classList.contains('ui-time-picker__column--quarter-snap')).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith('08:12');
  });

  it('does not add quarter-hour snapping to a plain tap', () => {
    const { minutes, onChange } = renderWheel();
    fireEvent.click(within(minutes).getByRole('option', { name: '12' }));
    expect(onChange).toHaveBeenLastCalledWith('08:12');
  });
});
