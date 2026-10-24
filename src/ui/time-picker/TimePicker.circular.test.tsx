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
  ])('settles a quick minute swipe from $stoppedAt to the closest quarter', ({ stoppedAt, expected }) => {
    // Fake the wheel's settle timeout without replacing the frame queue stub.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { minutes, onChange } = renderWheel();
    dispatchTouch(minutes, 'touchstart', 230, 100);
    minutes.scrollTop = (60 + stoppedAt) * 48;
    fireEvent.scroll(minutes);
    flushFrames();
    expect(onChange).toHaveBeenLastCalledWith(`08:${String(stoppedAt).padStart(2, '0')}`);
    const changesBeforeSettle = onChange.mock.calls.length;
    dispatchTouch(minutes, 'touchend', 100, 300);

    act(() => { vi.advanceTimersByTime(190); });
    flushFrames();
    expect(onChange.mock.calls.length).toBeGreaterThan(changesBeforeSettle);
    expect(onChange).toHaveBeenLastCalledWith(expected);
  });

  it('keeps an exact minute during deliberate slow dragging', () => {
    // Fake the wheel's settle timeout without replacing the frame queue stub.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { minutes, onChange } = renderWheel();
    dispatchTouch(minutes, 'touchstart', 230, 100);
    minutes.scrollTop = (60 + 32) * 48;
    fireEvent.scroll(minutes);
    flushFrames();
    dispatchTouch(minutes, 'touchend', 100, 800);

    act(() => { vi.advanceTimersByTime(250); });
    flushFrames();
    expect(onChange).toHaveBeenLastCalledWith('08:32');
  });

  it('does not add quarter-hour snapping to a plain tap', () => {
    const { minutes, onChange } = renderWheel();
    fireEvent.click(within(minutes).getByRole('option', { name: '12' }));
    expect(onChange).toHaveBeenLastCalledWith('08:12');
  });
});
