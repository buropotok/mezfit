// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { triggerTelegramSelectionHaptic } from '../../telegram';
import { DurationPicker } from '../duration-picker/DurationPicker';
import { WeightRepsPicker } from './WeightRepsPicker';

vi.mock('../../telegram', () => ({ triggerTelegramSelectionHaptic: vi.fn() }));

const ROW_HEIGHT = 48;
// Match TimePicker.circular.test.tsx: browser RAF callbacks run on a later frame.
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;

function flushFrames() {
  act(() => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach(callback => callback(0));
  });
}

function dispatchTouch(element: Element, type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
  y: number, time: number) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, 'timeStamp', { value: time });
  Object.defineProperty(event, type === 'touchend' ? 'changedTouches' : 'touches', {
    value: [{ clientY: y }],
  });
  fireEvent(element, event);
}

function renderWeight(valueKg = 77.5) {
  const target = document.createElement('button');
  document.body.appendChild(target);
  const onChange = vi.fn();
  const onClose = vi.fn();
  function Controlled() {
    const [value, setValue] = useState({ reps: 8, weightKg: valueKg });
    return (
      <KonstaProvider theme="ios" dark>
        <div className="k-ios dark">
          <WeightRepsPicker opened target={target} value={value}
            onChange={next => { onChange(next); setValue(next); }}
            onClose={onClose} />
        </div>
      </KonstaProvider>
    );
  }
  render(<Controlled />);
  flushFrames();
  return {
    onChange,
    onClose,
    kilograms: screen.getByRole('listbox', { name: 'Килограммы' }) as HTMLDivElement,
  };
}

function nativeScroll(element: HTMLDivElement, kilogram: number) {
  element.scrollTop = kilogram * ROW_HEIGHT;
  fireEvent.scroll(element);
  flushFrames();
}

beforeEach(() => {
  frames.clear();
  nextFrame = 0;
  vi.mocked(triggerTelegramSelectionHaptic).mockClear();
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
  document.body.innerHTML = '';
});

describe('WeightRepsPicker mirrors TimePicker native flick snapping, with step 10 instead of 15', () => {
  it('renders all 400 kilogram values and marks each tenth as the native fast-flick stop', () => {
    const { kilograms } = renderWeight();
    const options = within(kilograms).getAllByRole('option');
    expect(options).toHaveLength(400);
    expect(within(kilograms).getByRole('option', { name: '77' })
      .getAttribute('aria-selected')).toBe('true');
    expect(within(kilograms).getByRole('option', { name: '10' })
      .classList.contains('ui-time-picker__option--quarter-stop')).toBe(true);
    expect(within(kilograms).getByRole('option', { name: '77' })
      .classList.contains('ui-time-picker__option--quarter-stop')).toBe(false);
    expect(kilograms.classList.contains('ui-time-picker__column--quarter-snap')).toBe(false);
    expect(screen.getByRole('listbox', { name: 'Повторения' }).className)
      .not.toContain('ui-time-picker__column--quarter-snap');
    expect(screen.getByRole('listbox', { name: 'Доли килограмма' }).className)
      .not.toContain('ui-time-picker__column--quarter-snap');
  });

  it('scrolls precisely by one kilogram immediately, with no hold timer', () => {
    const { kilograms, onChange } = renderWeight();
    dispatchTouch(kilograms, 'touchstart', 230, 100);
    nativeScroll(kilograms, 78);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 78.5 });
    nativeScroll(kilograms, 79);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 79.5 });
    expect(kilograms.classList.contains('ui-time-picker__column--quarter-snap')).toBe(false);
    dispatchTouch(kilograms, 'touchend', 210, 160);
    expect(kilograms.classList.contains('ui-time-picker__column--quarter-snap')).toBe(false);
  });

  it('enables exactly the same fast-swipe snap as TimePicker and lands on multiples of 10', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { kilograms, onChange } = renderWeight();
    dispatchTouch(kilograms, 'touchstart', 230, 100);
    dispatchTouch(kilograms, 'touchmove', 100, 200);
    expect(kilograms.classList.contains('ui-time-picker__column--quarter-snap')).toBe(true);
    expect(within(kilograms).getByRole('option', { name: '80' })
      .classList.contains('ui-time-picker__option--quarter-stop')).toBe(true);
    expect(within(kilograms).getByRole('option', { name: '81' })
      .classList.contains('ui-time-picker__option--quarter-stop')).toBe(false);
    dispatchTouch(kilograms, 'touchend', 100, 300);
    expect(kilograms.classList.contains('ui-time-picker__column--quarter-snap')).toBe(true);

    // jsdom has no native momentum or CSS snap layout: simulate WebView's
    // inertial landing on a native 10kg stop, exactly as TimePicker tests do.
    nativeScroll(kilograms, 130);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 130.5 });
    const callsAtLanding = onChange.mock.calls.length;
    act(() => { vi.advanceTimersByTime(400); });
    flushFrames();
    expect(onChange).toHaveBeenCalledTimes(callsAtLanding);
    expect(kilograms.scrollTop).toBe(130 * ROW_HEIGHT);
  });

  it('keeps exact kilograms when dragging slowly, with the same thresholds as TimePicker', () => {
    const { kilograms, onChange } = renderWeight();
    dispatchTouch(kilograms, 'touchstart', 230, 100);
    nativeScroll(kilograms, 83);
    dispatchTouch(kilograms, 'touchend', 100, 800);
    expect(kilograms.classList.contains('ui-time-picker__column--quarter-snap')).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 83.5 });
  });

  it('uses the same fast-swipe velocity threshold as TimePicker', () => {
    const { kilograms } = renderWeight();
    dispatchTouch(kilograms, 'touchstart', 230, 100);
    dispatchTouch(kilograms, 'touchmove', 194, 300); // 36px / 200ms = 0.18px/ms.
    expect(kilograms.classList.contains('ui-time-picker__column--quarter-snap')).toBe(false);
    dispatchTouch(kilograms, 'touchend', 194, 300);

    dispatchTouch(kilograms, 'touchstart', 230, 400);
    dispatchTouch(kilograms, 'touchmove', 194, 480); // 36px / 80ms = 0.45px/ms.
    expect(kilograms.classList.contains('ui-time-picker__column--quarter-snap')).toBe(true);
  });

  it('resets native coarse snap on the next touch or a precise direct tap', () => {
    const { kilograms, onChange } = renderWeight();
    dispatchTouch(kilograms, 'touchstart', 230, 100);
    dispatchTouch(kilograms, 'touchmove', 100, 180);
    expect(kilograms.classList.contains('ui-time-picker__column--quarter-snap')).toBe(true);
    dispatchTouch(kilograms, 'touchend', 100, 250);

    dispatchTouch(kilograms, 'touchstart', 230, 400);
    expect(kilograms.classList.contains('ui-time-picker__column--quarter-snap')).toBe(false);
    dispatchTouch(kilograms, 'touchmove', 100, 480);
    expect(kilograms.classList.contains('ui-time-picker__column--quarter-snap')).toBe(true);

    fireEvent.click(within(kilograms).getByRole('option', { name: '83' }));
    expect(kilograms.classList.contains('ui-time-picker__column--quarter-snap')).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 83.5 });
  });

  it('preserves snap targets if WebView takes ownership and dispatches touchcancel', () => {
    const { kilograms } = renderWeight();
    dispatchTouch(kilograms, 'touchstart', 230, 100);
    dispatchTouch(kilograms, 'touchmove', 100, 180);
    expect(kilograms.classList.contains('ui-time-picker__column--quarter-snap')).toBe(true);
    dispatchTouch(kilograms, 'touchcancel', 100, 190);
    expect(kilograms.classList.contains('ui-time-picker__column--quarter-snap')).toBe(true);
  });

  it('commits the nearest 10kg target on backdrop dismissal mid-inertia like TimePicker', () => {
    const { kilograms, onChange, onClose } = renderWeight();
    dispatchTouch(kilograms, 'touchstart', 230, 100);
    dispatchTouch(kilograms, 'touchmove', 100, 180);
    expect(kilograms.classList.contains('ui-time-picker__column--quarter-snap')).toBe(true);
    kilograms.scrollTop = 126 * ROW_HEIGHT;
    const dialog = screen.getByRole('dialog', { name: 'Повторения и вес' });
    fireEvent.click(dialog.previousElementSibling as Element);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 130.5 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the last exact value and fractional part available', () => {
    const { kilograms, onChange } = renderWeight(399.75);
    expect(within(kilograms).getAllByRole('option')).toHaveLength(400);
    expect(within(kilograms).getByRole('option', { name: '399' })
      .getAttribute('aria-selected')).toBe('true');
    fireEvent.click(within(kilograms).getByRole('option', { name: '398' }));
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 398.75 });
  });

  it('does not modify DurationPicker native columns', () => {
    const target = document.createElement('button');
    document.body.appendChild(target);
    render(
      <KonstaProvider theme="ios" dark>
        <div className="k-ios dark">
          <DurationPicker opened value={125} target={target}
            onChange={vi.fn()} onClose={vi.fn()} />
        </div>
      </KonstaProvider>,
    );
    expect(screen.getByRole('listbox', { name: 'Минуты продолжительности' }).className)
      .not.toContain('ui-time-picker__column--quarter-snap');
  });
});
