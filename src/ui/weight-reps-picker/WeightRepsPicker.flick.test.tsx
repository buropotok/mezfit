// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { triggerTelegramSelectionHaptic } from '../../telegram';
import { DurationPicker } from '../duration-picker/DurationPicker';
import { WeightRepsPicker } from './WeightRepsPicker';

vi.mock('../../telegram', () => ({ triggerTelegramSelectionHaptic: vi.fn() }));

let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;

function flushFrame(timestamp: number) {
  const callbacks = [...frames.values()];
  frames.clear();
  act(() => callbacks.forEach(callback => callback(timestamp)));
}

function finishMomentum() {
  for (let i = 0; i < 100 && frames.size; i += 1) flushFrame(i * 16);
  expect(frames.size).toBe(0);
}

function touch(element: HTMLElement, type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel', y: number, time: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'timeStamp', { value: time });
  Object.defineProperty(event, 'touches', { value: type === 'touchend' || type === 'touchcancel' ? [] : [{ clientY: y }] });
  Object.defineProperty(event, 'changedTouches', { value: [{ clientY: y }] });
  fireEvent(element, event);
  return event;
}

function mountWeight(initialKg = 100.5) {
  const target = document.createElement('button');
  document.body.appendChild(target);
  const onChange = vi.fn();
  const onClose = vi.fn();
  function ControlledPicker() {
    const [value, setValue] = useState({ reps: 8, weightKg: initialKg });
    return (
      <KonstaProvider theme="ios" dark>
        <div className="k-ios dark">
          <WeightRepsPicker opened target={target} value={value}
            onChange={next => { onChange(next); setValue(next); }} onClose={onClose} />
        </div>
      </KonstaProvider>
    );
  }
  render(<ControlledPicker />);
  flushFrame(0); // Mount's initial positioning frame.
  return { onChange, onClose };
}

beforeEach(() => {
  frames = new Map();
  nextFrame = 1;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.mocked(triggerTelegramSelectionHaptic).mockClear();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextFrame++;
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

describe('WeightRepsPicker hold-versus-swipe kilogram control', () => {
  it('uses a private gesture controller for kilograms but keeps other wheels native', () => {
    mountWeight();
    expect(screen.getByRole('listbox', { name: 'Килограммы' }).className)
      .toContain('ui-time-picker__column--gesture-scrub');
    expect(screen.getByRole('listbox', { name: 'Повторения' }).className)
      .not.toContain('ui-time-picker__column--gesture-scrub');
    expect(screen.getByRole('listbox', { name: 'Доли килограмма' }).className)
      .not.toContain('ui-time-picker__column--gesture-scrub');
  });

  it('a slow swipe still selects tens, not one-kilogram increments', () => {
    const { onChange } = mountWeight();
    const wheel = screen.getByRole('listbox', { name: 'Килограммы' });
    touch(wheel, 'touchstart', 200, 100);
    touch(wheel, 'touchmove', 120, 500); // Two physical tick distances, slowly.
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 120.5 });
    touch(wheel, 'touchend', 120, 550);
    finishMomentum();
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 130.5 });
    expect(onChange.mock.calls.every(([value]) => value.weightKg % 10 === 0.5)).toBe(true);
    expect(triggerTelegramSelectionHaptic).toHaveBeenCalledTimes(3);
  });

  it('a fast swipe covers many more tens with velocity-scaled deceleration', () => {
    const { onChange } = mountWeight();
    const wheel = screen.getByRole('listbox', { name: 'Килограммы' });
    touch(wheel, 'touchstart', 200, 100);
    touch(wheel, 'touchmove', 120, 150); // Same 80px, eight times faster.
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 120.5 });
    touch(wheel, 'touchend', 120, 175);
    finishMomentum();
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 220.5 });
    expect(onChange.mock.calls.every(([value]) => value.weightKg % 10 === 0.5)).toBe(true);
    // 100 -> 120 during the finger gesture, then ten more decade ticks.
    expect(triggerTelegramSelectionHaptic).toHaveBeenCalledTimes(12);
  });

  it('holding and then moving the finger selects exact kilograms without an inertial fling', () => {
    const { onChange } = mountWeight(280.25);
    const wheel = screen.getByRole('listbox', { name: 'Килограммы' });
    touch(wheel, 'touchstart', 200, 100);
    act(() => vi.advanceTimersByTime(240));
    touch(wheel, 'touchmove', 104, 400); // 96px / 48px = 2kg.
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 282.25 });
    touch(wheel, 'touchend', 104, 420);
    finishMomentum();
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 282.25 });
    expect(triggerTelegramSelectionHaptic).toHaveBeenCalledTimes(2);
  });

  it('works across 299 -> 300 with one tactile event per decade', () => {
    const { onChange } = mountWeight(290.75);
    const wheel = screen.getByRole('listbox', { name: 'Килограммы' });
    touch(wheel, 'touchstart', 200, 100);
    touch(wheel, 'touchmove', 160, 200);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 300.75 });
    expect(triggerTelegramSelectionHaptic).toHaveBeenCalledTimes(1);
    touch(wheel, 'touchend', 160, 220);
    finishMomentum();
    expect(onChange.mock.calls.every(([value]) => value.weightKg % 10 === 0.75)).toBe(true);
  });

  it('cancels an active fling on the next touch and allows fine adjustment', () => {
    const { onChange } = mountWeight();
    const wheel = screen.getByRole('listbox', { name: 'Килограммы' });
    touch(wheel, 'touchstart', 200, 100);
    touch(wheel, 'touchmove', 120, 150);
    touch(wheel, 'touchend', 120, 175);
    flushFrame(0);
    flushFrame(48);
    const stoppedAt = onChange.mock.lastCall?.[0].weightKg as number;
    touch(wheel, 'touchstart', 200, 300);
    expect(frames.size).toBe(0);
    act(() => vi.advanceTimersByTime(240));
    touch(wheel, 'touchmove', 152, 550);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: stoppedAt + 1 });
    touch(wheel, 'touchend', 152, 580);
    finishMomentum();
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: stoppedAt + 1 });
  });

  it('keeps direct taps exact and does not synthesize a click from a swipe', () => {
    const { onChange } = mountWeight(280.5);
    const wheel = screen.getByRole('listbox', { name: 'Килограммы' });
    fireEvent.click(within(wheel).getByRole('option', { name: '283' }));
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 283.5 });
    expect(triggerTelegramSelectionHaptic).toHaveBeenCalledTimes(1);
    touch(wheel, 'touchstart', 200, 100);
    touch(wheel, 'touchmove', 160, 180);
    const endEvent = touch(wheel, 'touchend', 160, 200);
    expect(endEvent.defaultPrevented).toBe(true);
  });

  it('preserves the upper boundary without wrapping or infinite momentum', () => {
    const { onChange } = mountWeight(385.75);
    const wheel = screen.getByRole('listbox', { name: 'Килограммы' });
    touch(wheel, 'touchstart', 200, 100);
    touch(wheel, 'touchmove', 120, 130);
    touch(wheel, 'touchend', 120, 150);
    finishMomentum();
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 390.75 });
    expect(frames.size).toBe(0);
  });

  it('leaves the existing duration picker unchanged', () => {
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
