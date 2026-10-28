// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { triggerTelegramSelectionHaptic } from '../../telegram';
import { WeightRepsPicker } from './WeightRepsPicker';

vi.mock('../../telegram', () => ({ triggerTelegramSelectionHaptic: vi.fn() }));

const ROW_HEIGHT = 48;
let frames: Map<number, FrameRequestCallback>;
let nextId: number;

function flushFrames() {
  for (let i = 0; i < 12 && frames.size; i += 1) {
    const work = [...frames.values()];
    frames.clear();
    act(() => work.forEach(callback => callback(i * 16)));
  }
  expect(frames.size).toBe(0);
}

function touch(element: HTMLElement, type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
  y: number, at: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'timeStamp', { value: at });
  Object.defineProperty(event, 'touches', { value: type === 'touchend' || type === 'touchcancel'
    ? [] : [{ clientY: y }] });
  Object.defineProperty(event, 'changedTouches', { value: [{ clientY: y }] });
  fireEvent(element, event);
}

function mountWeight(initialWeight = 280.25, acknowledgeChanges = true) {
  const target = document.createElement('button');
  document.body.appendChild(target);
  const onChange = vi.fn();
  const onClose = vi.fn();
  function Picker() {
    const [value, setValue] = useState({ reps: 8, weightKg: initialWeight });
    return (
      <KonstaProvider theme="ios" dark>
        <div className="k-ios dark">
          <WeightRepsPicker opened target={target} value={value}
            onChange={next => { onChange(next); if (acknowledgeChanges) setValue(next); }} onClose={onClose} />
        </div>
      </KonstaProvider>
    );
  }
  render(<Picker />);
  flushFrames();
  return { onChange, onClose, wheel: screen.getByRole('listbox', { name: 'Килограммы' }) as HTMLDivElement };
}

function nativeMove(wheel: HTMLDivElement, index: number) {
  act(() => {
    wheel.scrollTop = index * ROW_HEIGHT;
    fireEvent.scroll(wheel);
  });
  flushFrames();
}

beforeEach(() => {
  frames = new Map();
  nextId = 1;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.mocked(triggerTelegramSelectionHaptic).mockClear();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextId++;
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

describe('WeightRepsPicker native hold-to-one-kilogram precision', () => {
  it('switches the same native wheel from coarse to all 400 individual kilograms after holding', () => {
    const { wheel } = mountWeight();
    expect(within(wheel).getAllByRole('option')).toHaveLength(40);
    touch(wheel, 'touchstart', 200, 100);
    act(() => vi.advanceTimersByTime(240));
    expect(within(wheel).getAllByRole('option')).toHaveLength(400);
    expect(within(wheel).getByRole('option', { name: '281' })).toBeTruthy();
    expect(within(wheel).getByRole('option', { name: '280' }).getAttribute('aria-selected')).toBe('true');
  });

  it('tolerates 16px drift while stationary and follows native 1kg rows after the hold', () => {
    const { onChange, wheel } = mountWeight();
    touch(wheel, 'touchstart', 200, 100);
    touch(wheel, 'touchmove', 184, 160);
    expect(within(wheel).getAllByRole('option')).toHaveLength(40);
    act(() => vi.advanceTimersByTime(240));
    expect(within(wheel).getAllByRole('option')).toHaveLength(400);
    nativeMove(wheel, 281);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 281.25 });
    touch(wheel, 'touchend', 152, 420);
    fireEvent(wheel, new Event('scrollend', { bubbles: true }));
    flushFrames();
    // Releasing a fine hold must not turn the same gesture back to decades.
    expect(within(wheel).getAllByRole('option')).toHaveLength(400);
    expect(within(wheel).getByRole('option', { name: '281' }).getAttribute('aria-selected')).toBe('true');
    expect(triggerTelegramSelectionHaptic).toHaveBeenCalledTimes(1);
  });

  it('enters fine mode from event timestamps when WKWebView delays the timeout', () => {
    const { onChange, wheel } = mountWeight();
    touch(wheel, 'touchstart', 200, 100);
    // No vi.advanceTimersByTime call: the WebView has not delivered the timer.
    touch(wheel, 'touchmove', 182, 385);
    expect(within(wheel).getAllByRole('option')).toHaveLength(400);
    nativeMove(wheel, 282);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 282.25 });
    touch(wheel, 'touchend', 152, 420);
  });

  it('keeps a slow decade swipe coarse when displacement begins before the hold', () => {
    const { onChange, wheel } = mountWeight(100.5);
    touch(wheel, 'touchstart', 200, 100);
    touch(wheel, 'touchmove', 178, 180); // Movement began 80ms after contact.
    touch(wheel, 'touchmove', 120, 500); // Moving slowly does not switch modes.
    expect(within(wheel).getAllByRole('option')).toHaveLength(40);
    nativeMove(wheel, 12);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 120.5 });
    touch(wheel, 'touchend', 120, 550);
  });

  it('does not reset a fine-grained wheel during delayed parent acknowledgements', () => {
    const { onChange, wheel } = mountWeight(280.25, false);
    touch(wheel, 'touchstart', 200, 100);
    act(() => vi.advanceTimersByTime(240));
    const appScrollTo = vi.fn();
    Object.defineProperty(wheel, 'scrollTo', { configurable: true, value: appScrollTo });
    nativeMove(wheel, 281);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 281.25 });
    nativeMove(wheel, 282);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 282.25 });
    expect(within(wheel).getByRole('option', { name: '282' })
      .getAttribute('aria-selected')).toBe('true');
    expect(appScrollTo).not.toHaveBeenCalled();
  });

  it('changes 299 -> 300 -> 301 individually without a programmatic fling', () => {
    const { onChange, wheel } = mountWeight(299.75);
    touch(wheel, 'touchstart', 200, 100);
    act(() => vi.advanceTimersByTime(240));
    nativeMove(wheel, 300);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 300.75 });
    nativeMove(wheel, 301);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 301.75 });
    expect(triggerTelegramSelectionHaptic).toHaveBeenCalledTimes(2);
    touch(wheel, 'touchend', 100, 410);
    fireEvent(wheel, new Event('scrollend', { bubbles: true }));
    flushFrames();
    expect(within(wheel).getAllByRole('option')).toHaveLength(400);
    nativeMove(wheel, 302);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 302.75 });
    expect(triggerTelegramSelectionHaptic).toHaveBeenCalledTimes(3);
  });

  it('holds 1kg mode when WebView sends touchcancel before the first scroll event', () => {
    const { onChange, wheel } = mountWeight(280.5);
    touch(wheel, 'touchstart', 200, 100);
    act(() => vi.advanceTimersByTime(240));
    expect(within(wheel).getAllByRole('option')).toHaveLength(400);
    // Native pan starts. WKWebView takes ownership via touchcancel *before*
    // onScroll, so there is no scrollingPartsRef entry yet.
    touch(wheel, 'touchcancel', 152, 360);
    expect(within(wheel).getAllByRole('option')).toHaveLength(400);
    nativeMove(wheel, 281);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 281.5 });
    nativeMove(wheel, 282);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 282.5 });
    fireEvent(wheel, new Event('scrollend', { bubbles: true }));
    flushFrames();
    expect(within(wheel).getAllByRole('option')).toHaveLength(400);
    // Only an entirely new gesture may start the coarse (10kg) wheel.
    touch(wheel, 'touchstart', 200, 600);
    expect(within(wheel).getAllByRole('option')).toHaveLength(40);
    expect(within(wheel).getByRole('option', { name: '282' }).getAttribute('aria-selected')).toBe('true');
    touch(wheel, 'touchend', 200, 620);
  });

  it('keeps an already recognized hold precise during rapid movement after touchcancel', () => {
    const { onChange, wheel } = mountWeight(280.25);
    touch(wheel, 'touchstart', 200, 100);
    act(() => vi.advanceTimersByTime(240));
    touch(wheel, 'touchmove', 155, 365);
    touch(wheel, 'touchcancel', 95, 385);
    nativeMove(wheel, 282);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 282.25 });
    nativeMove(wheel, 290);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 290.25 });
    expect(within(wheel).getAllByRole('option')).toHaveLength(400);
    fireEvent(wheel, new Event('scrollend', { bubbles: true }));
    flushFrames();
    expect(within(wheel).getAllByRole('option')).toHaveLength(400);
  });

  it('treats a late first move after holding as precise even if it spans 80px', () => {
    const { onChange, wheel } = mountWeight(100.5);
    touch(wheel, 'touchstart', 200, 100);
    // Simulate WebView delaying setTimeout: elapsed touch time decides.
    touch(wheel, 'touchmove', 120, 500);
    expect(within(wheel).getAllByRole('option')).toHaveLength(400);
    nativeMove(wheel, 102);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 102.5 });
    touch(wheel, 'touchcancel', 60, 550);
    expect(within(wheel).getAllByRole('option')).toHaveLength(400);
  });

  it('keeps a stationary recognized hold fine after release until a new touch', () => {
    const { wheel } = mountWeight(281.25);
    touch(wheel, 'touchstart', 200, 100);
    act(() => vi.advanceTimersByTime(240));
    touch(wheel, 'touchend', 200, 350);
    expect(within(wheel).getAllByRole('option')).toHaveLength(400);
    touch(wheel, 'touchstart', 200, 500);
    expect(within(wheel).getAllByRole('option')).toHaveLength(40);
    touch(wheel, 'touchend', 200, 520);
  });

  it('recovers fine precision on touchcancel after a delayed hold timer and no touchmove', () => {
    const { onChange, wheel } = mountWeight(280.25);
    touch(wheel, 'touchstart', 200, 100);
    // The timer did not run and WebView delivered no intermediate touchmove.
    touch(wheel, 'touchcancel', 148, 400);
    expect(within(wheel).getAllByRole('option')).toHaveLength(400);
    nativeMove(wheel, 281);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 281.25 });
    fireEvent(wheel, new Event('scrollend', { bubbles: true }));
    flushFrames();
    expect(within(wheel).getAllByRole('option')).toHaveLength(400);
  });

  it('recognizes the completed stationary hold even if its timeout never ran', () => {
    const { wheel } = mountWeight(280.25);
    touch(wheel, 'touchstart', 200, 100);
    touch(wheel, 'touchend', 200, 400);
    expect(within(wheel).getAllByRole('option')).toHaveLength(400);
    touch(wheel, 'touchstart', 200, 600);
    expect(within(wheel).getAllByRole('option')).toHaveLength(40);
    touch(wheel, 'touchend', 200, 620);
  });

  it('never upgrades an already detected swipe into fine mode on late touchcancel', () => {
    const { wheel } = mountWeight(100.5);
    touch(wheel, 'touchstart', 200, 100);
    touch(wheel, 'touchmove', 165, 150); // Start movement before hold threshold.
    touch(wheel, 'touchcancel', 120, 500); // Long duration after gesture started.
    expect(within(wheel).getAllByRole('option')).toHaveLength(40);
  });

  it('prevents the native long-press context menu without blocking row selection', () => {
    const { onChange, wheel } = mountWeight();
    const option = within(wheel).getByRole('option', { name: '280' });
    const context = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    fireEvent(option, context);
    expect(context.defaultPrevented).toBe(true);
    fireEvent.click(within(wheel).getByRole('option', { name: '290' }));
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 290.25 });
  });

  it('does not enable fine mode after touchcancel and allows a fresh hold', () => {
    const { wheel } = mountWeight();
    touch(wheel, 'touchstart', 200, 100);
    touch(wheel, 'touchcancel', 200, 140);
    act(() => vi.advanceTimersByTime(500));
    expect(within(wheel).getAllByRole('option')).toHaveLength(40);
    touch(wheel, 'touchstart', 200, 700);
    act(() => vi.advanceTimersByTime(240));
    expect(within(wheel).getAllByRole('option')).toHaveLength(400);
  });

  it('commits the visible fine value if the popover closes before scrollend', () => {
    const { onChange, onClose, wheel } = mountWeight();
    touch(wheel, 'touchstart', 200, 100);
    act(() => vi.advanceTimersByTime(240));
    wheel.scrollTop = 283 * ROW_HEIGHT;
    const dialog = screen.getByRole('dialog', { name: 'Повторения и вес' });
    fireEvent.click(dialog.previousElementSibling as Element);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 283.25 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
