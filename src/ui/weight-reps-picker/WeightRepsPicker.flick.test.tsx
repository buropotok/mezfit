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
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;

function flushFrames() {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(0));
  });
}

function touch(element: Element, type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
  y: number, time: number) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, 'timeStamp', { value: time });
  Object.defineProperty(event, type === 'touchend' ? 'changedTouches' : 'touches', {
    value: [{ clientY: y }],
  });
  fireEvent(element, event);
}

function renderWeight(valueKg = 23.5) {
  const target = document.createElement('button');
  document.body.appendChild(target);
  const onChange = vi.fn();
  const onClose = vi.fn();
  const externalSetter: { current: ((nextKg: number) => void) | null } = { current: null };
  function Controlled() {
    const [value, setValue] = useState({ reps: 8, weightKg: valueKg });
    externalSetter.current = (nextKg) => setValue((previous) => ({ ...previous, weightKg: nextKg }));
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
    setExternalKg(nextKg: number) {
      act(() => externalSetter.current?.(nextKg));
    },
    kilograms: screen.getByRole('listbox', { name: 'Килограммы' }) as HTMLDivElement,
  };
}

function nativeScroll(wheel: HTMLDivElement, row: number) {
  wheel.scrollTop = row * ROW_HEIGHT;
  fireEvent.scroll(wheel);
  flushFrames();
}

function startFastFlick(wheel: HTMLDivElement, start = 100) {
  touch(wheel, 'touchstart', 230, start);
  touch(wheel, 'touchmove', 100, start + 80);
  expect(wheel.classList.contains('ui-time-picker__column--quarter-snap')).toBe(true);
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

describe('WeightRepsPicker native relative ten-kilogram flick', () => {
  it('starts with every one-kilogram row and keeps normal precision immediately', () => {
    const { kilograms, onChange } = renderWeight();
    expect(within(kilograms).getAllByRole('option')).toHaveLength(400);
    expect(within(kilograms).getByRole('option', { name: '23' })
      .getAttribute('aria-selected')).toBe('true');
    touch(kilograms, 'touchstart', 230, 100);
    nativeScroll(kilograms, 24);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 24.5 });
    nativeScroll(kilograms, 25);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 25.5 });
    expect(kilograms.classList.contains('ui-time-picker__column--quarter-snap')).toBe(false);
    touch(kilograms, 'touchend', 210, 180);
  });

  it('switches to actual 23, 33, 43, 53 rows on fast swipe, not 20, 30, 40', () => {
    const { kilograms, onChange } = renderWeight(23.5);
    startFastFlick(kilograms);
    const labels = within(kilograms).getAllByRole('option').map(option => option.textContent);
    expect(labels).toHaveLength(40);
    expect(labels.slice(0, 7)).toEqual(['3', '13', '23', '33', '43', '53', '63']);
    expect(within(kilograms).queryByRole('option', { name: '20' })).toBeNull();
    expect(within(kilograms).getByRole('option', { name: '23' }).getAttribute('aria-selected')).toBe('true');
    nativeScroll(kilograms, 3);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 33.5 });
    nativeScroll(kilograms, 4);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 43.5 });
    nativeScroll(kilograms, 5);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 53.5 });
    expect(onChange.mock.calls.every(([value]) => value.weightKg % 10 === 3.5)).toBe(true);
    expect(triggerTelegramSelectionHaptic).toHaveBeenCalledTimes(3);
  });

  it('preserves the actual physical finger displacement when fast mode activates', () => {
    const { kilograms, onChange } = renderWeight();
    touch(kilograms, 'touchstart', 230, 100);
    // The native wheel already travelled two 1kg rows before detecting speed.
    nativeScroll(kilograms, 25);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 25.5 });
    touch(kilograms, 'touchmove', 100, 180);
    expect(within(kilograms).getAllByRole('option')).toHaveLength(40);
    // Two travelled physical rows now represent +20kg relative to 23.
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 43.5 });
    expect(kilograms.scrollTop).toBe(4 * ROW_HEIGHT);
    nativeScroll(kilograms, 5);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 53.5 });
  });

  it('moves backward in tens relative to 23 and clamps at the first valid row', () => {
    const { kilograms, onChange } = renderWeight();
    startFastFlick(kilograms);
    nativeScroll(kilograms, 1);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 13.5 });
    nativeScroll(kilograms, 0);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 3.5 });
    expect(within(kilograms).getByRole('option', { name: '3' })
      .getAttribute('aria-selected')).toBe('true');
  });

  it('retains native inertial movement in relative 10kg mode after touchend and touchcancel', () => {
    const { kilograms, onChange } = renderWeight();
    startFastFlick(kilograms);
    touch(kilograms, 'touchend', 100, 260);
    expect(within(kilograms).getAllByRole('option')).toHaveLength(40);
    nativeScroll(kilograms, 6);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 63.5 });
    touch(kilograms, 'touchcancel', 100, 270);
    expect(within(kilograms).getAllByRole('option')).toHaveLength(40);
    nativeScroll(kilograms, 7);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 73.5 });
    fireEvent(kilograms, new Event('scrollend', { bubbles: true }));
    flushFrames();
    expect(within(kilograms).getAllByRole('option')).toHaveLength(40);
  });

  it('resets to the exact 1kg wheel on the next independent touch without changing the value', () => {
    const { kilograms, onChange } = renderWeight();
    startFastFlick(kilograms);
    nativeScroll(kilograms, 4);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 43.5 });
    touch(kilograms, 'touchend', 100, 260);
    const changes = onChange.mock.calls.length;
    touch(kilograms, 'touchstart', 230, 400);
    expect(within(kilograms).getAllByRole('option')).toHaveLength(400);
    expect(within(kilograms).getByRole('option', { name: '43' })
      .getAttribute('aria-selected')).toBe('true');
    expect(kilograms.scrollTop).toBe(43 * ROW_HEIGHT);
    expect(onChange).toHaveBeenCalledTimes(changes);
    nativeScroll(kilograms, 44);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 44.5 });
  });

  it('keeps a slow swipe on individual kilograms using unchanged TimePicker thresholds', () => {
    const { kilograms, onChange } = renderWeight();
    touch(kilograms, 'touchstart', 230, 100);
    touch(kilograms, 'touchmove', 194, 300); // 36px/200ms = 0.18 < 0.35.
    expect(within(kilograms).getAllByRole('option')).toHaveLength(400);
    nativeScroll(kilograms, 26);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 26.5 });
    touch(kilograms, 'touchend', 100, 800);
    expect(kilograms.classList.contains('ui-time-picker__column--quarter-snap')).toBe(false);
  });

  it('preserves relative tens for arbitrary starts and reaches 397 without rounding', () => {
    const { kilograms, onChange } = renderWeight(287.75);
    startFastFlick(kilograms);
    expect(within(kilograms).getAllByRole('option')).toHaveLength(40);
    expect(within(kilograms).getByRole('option', { name: '287' }).getAttribute('aria-selected')).toBe('true');
    nativeScroll(kilograms, 29);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 297.75 });
    nativeScroll(kilograms, 39);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 397.75 });
  });

  it('keeps exact direct taps and restores fine rows after a coarse tap', () => {
    const { kilograms, onChange } = renderWeight();
    startFastFlick(kilograms);
    fireEvent.click(within(kilograms).getByRole('option', { name: '53' }));
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 53.5 });
    expect(within(kilograms).getAllByRole('option')).toHaveLength(400);
    expect(within(kilograms).getByRole('option', { name: '53' })
      .getAttribute('aria-selected')).toBe('true');
    fireEvent.click(within(kilograms).getByRole('option', { name: '54' }));
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 54.5 });
  });

  it('preserves an external weight update during relative inertia without writing back stale kilograms', () => {
    const { kilograms, onChange, setExternalKg } = renderWeight();
    startFastFlick(kilograms);
    nativeScroll(kilograms, 3);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 33.5 });
    const priorCalls = onChange.mock.calls.length;
    setExternalKg(81.25);
    expect(within(kilograms).getAllByRole('option')).toHaveLength(400);
    expect(within(kilograms).getByRole('option', { name: '81' })
      .getAttribute('aria-selected')).toBe('true');
    expect(kilograms.scrollTop).toBe(81 * ROW_HEIGHT);
    expect(onChange).toHaveBeenCalledTimes(priorCalls);
  });

  it('commits the actual relative value on closing mid-inertia, without rounding to global tens', () => {
    const { kilograms, onChange, onClose } = renderWeight();
    startFastFlick(kilograms);
    kilograms.scrollTop = 4.9 * ROW_HEIGHT;
    const dialog = screen.getByRole('dialog', { name: 'Повторения и вес' });
    fireEvent.click(dialog.previousElementSibling as Element);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 53.5 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not alter the repetition, fraction or duration wheel configurations', () => {
    const { kilograms } = renderWeight();
    expect(kilograms.className).not.toContain('ui-time-picker__column--quarter-snap');
    expect(screen.getByRole('listbox', { name: 'Повторения' }).className)
      .not.toContain('ui-time-picker__column--quarter-snap');
    expect(screen.getByRole('listbox', { name: 'Доли килограмма' }).className)
      .not.toContain('ui-time-picker__column--quarter-snap');
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
