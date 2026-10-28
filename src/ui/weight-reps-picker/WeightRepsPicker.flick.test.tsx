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
let frames: Map<number, FrameRequestCallback>;
let frameId: number;

function flushFrames() {
  for (let i = 0; i < 12 && frames.size; i += 1) {
    const callbacks = [...frames.values()];
    frames.clear();
    act(() => callbacks.forEach(callback => callback(i * 16)));
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

function mountWeight(initialKg = 100.5) {
  const target = document.createElement('button');
  document.body.appendChild(target);
  const onChange = vi.fn();
  const onClose = vi.fn();
  function Controlled() {
    const [value, setValue] = useState({ reps: 8, weightKg: initialKg });
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
  return { onChange, onClose, kilograms: screen.getByRole('listbox', { name: 'Килограммы' }) as HTMLDivElement };
}

function nativeMove(wheel: HTMLDivElement, physicalRow: number) {
  act(() => {
    // Simulate a position produced by the WebView itself (no application writes).
    wheel.scrollTop = physicalRow * ROW_HEIGHT;
    fireEvent.scroll(wheel);
  });
  flushFrames();
}

beforeEach(() => {
  frames = new Map();
  frameId = 1;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.mocked(triggerTelegramSelectionHaptic).mockClear();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = frameId++;
    frames.set(id, cb);
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

describe('WeightRepsPicker native TimePicker-style kilogram wheel', () => {
  it('renders every tenth kilogram as a physical native snap row', () => {
    const { kilograms } = mountWeight();
    expect(kilograms.className).toContain('ui-time-picker__column--gesture-scrub');
    const options = within(kilograms).getAllByRole('option');
    expect(options).toHaveLength(40);
    expect(options[0].textContent).toBe('0');
    expect(options[10].textContent).toBe('100');
    expect(options[39].textContent).toBe('390');
    expect(within(kilograms).queryByRole('option', { name: '101' })).toBeNull();
    expect(screen.getByRole('listbox', { name: 'Повторения' }).className)
      .not.toContain('ui-time-picker__column--gesture-scrub');
    expect(screen.getByRole('listbox', { name: 'Доли килограмма' }).className)
      .not.toContain('ui-time-picker__column--gesture-scrub');
  });

  it('commits ten kilograms per native row, without steering the browser scroll position', () => {
    const { kilograms, onChange } = mountWeight();
    const appScrollTo = vi.fn();
    Object.defineProperty(kilograms, 'scrollTo', { configurable: true, value: appScrollTo });
    nativeMove(kilograms, 11);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 110.5 });
    nativeMove(kilograms, 21);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 210.5 });
    expect(appScrollTo).not.toHaveBeenCalled();
    // Like TimePicker, a native scroll event reports the current selection;
    // skipped intermediate rows do not trigger a burst of hidden haptics.
    expect(triggerTelegramSelectionHaptic).toHaveBeenCalledTimes(2);
  });

  it('keeps the original kilogram units when a swipe begins from 77.75', () => {
    const { kilograms, onChange } = mountWeight(77.75);
    expect(within(kilograms).getAllByRole('option')).toHaveLength(40);
    expect(within(kilograms).getByRole('option', { name: '77' }).getAttribute('aria-selected')).toBe('true');
    nativeMove(kilograms, 8);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 87.75 });
    nativeMove(kilograms, 9);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 97.75 });
  });

  it('lets WebView own inertia after finger release instead of starting a JavaScript fling', () => {
    const { kilograms, onChange } = mountWeight();
    touch(kilograms, 'touchstart', 200, 100);
    touch(kilograms, 'touchmove', 120, 160);
    touch(kilograms, 'touchend', 120, 190);
    expect(frames.size).toBe(0);
    nativeMove(kilograms, 16); // Native momentum still generates scroll events.
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 160.5 });
    nativeMove(kilograms, 20);
    fireEvent(kilograms, new Event('scrollend', { bubbles: true }));
    flushFrames();
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 200.5 });
    expect(frames.size).toBe(0);
  });

  it('preserves native momentum when WebView takes the touch and dispatches touchcancel', () => {
    const { kilograms, onChange } = mountWeight();
    touch(kilograms, 'touchstart', 200, 100);
    touch(kilograms, 'touchmove', 100, 150);
    touch(kilograms, 'touchcancel', 100, 165);
    expect(within(kilograms).getAllByRole('option')).toHaveLength(40);
    nativeMove(kilograms, 14);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 140.5 });
  });

  it('stays within finite kilogram bounds without wraparound', () => {
    const { kilograms, onChange } = mountWeight(385.75);
    expect(within(kilograms).getAllByRole('option')).toHaveLength(40);
    nativeMove(kilograms, 39);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 395.75 });
    expect(within(kilograms).getByRole('option', { name: '395' })
      .getAttribute('aria-selected')).toBe('true');
  });

  it('still permits a direct tap on any displayed coarse row', () => {
    const { kilograms, onChange } = mountWeight(77.5);
    fireEvent.click(within(kilograms).getByRole('option', { name: '307' }));
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 307.5 });
    expect(triggerTelegramSelectionHaptic).toHaveBeenCalledTimes(1);
  });

  it('does not change the other three-column pickers', () => {
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
      .not.toContain('ui-time-picker__column--gesture-scrub');
  });
});
