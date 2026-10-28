// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { triggerTelegramSelectionHaptic } from '../../telegram';
import { WeightRepsPicker } from './WeightRepsPicker';

vi.mock('../../telegram', () => ({ triggerTelegramSelectionHaptic: vi.fn() }));

let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;

function flushAnimation() {
  for (let tick = 0; tick < 100 && frames.size > 0; tick += 1) {
    const callbacks = [...frames.values()];
    frames.clear();
    act(() => callbacks.forEach(callback => callback(tick * 16)));
  }
  expect(frames.size).toBe(0);
}

function touch(element: HTMLElement, type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel', y: number, time: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'timeStamp', { value: time });
  Object.defineProperty(event, 'touches', {
    value: type === 'touchend' || type === 'touchcancel' ? [] : [{ clientY: y }],
  });
  Object.defineProperty(event, 'changedTouches', { value: [{ clientY: y }] });
  fireEvent(element, event);
}

function mountControlled(initialWeight = 280.25) {
  const target = document.createElement('button');
  document.body.appendChild(target);
  const onChange = vi.fn();
  function Picker() {
    const [value, setValue] = useState({ reps: 8, weightKg: initialWeight });
    return (
      <KonstaProvider theme="ios" dark>
        <div className="k-ios dark">
          <WeightRepsPicker opened value={value} target={target}
            onChange={(next) => { onChange(next); setValue(next); }} onClose={vi.fn()} />
        </div>
      </KonstaProvider>
    );
  }
  render(<Picker />);
  flushAnimation();
  return { onChange, wheel: screen.getByRole('listbox', { name: 'Килограммы' }) };
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

describe('WeightRepsPicker hold gesture reliability', () => {
  it('tolerates small finger drift before hold activation and then selects exact units', () => {
    const { onChange, wheel } = mountControlled();
    touch(wheel, 'touchstart', 200, 100);
    touch(wheel, 'touchmove', 191, 160); // 9px: drift, not an intentional swipe.
    expect(onChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(240));
    touch(wheel, 'touchmove', 143, 410); // 57px from start, one 48px row.
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 281.25 });
    touch(wheel, 'touchend', 143, 430);
    flushAnimation();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(triggerTelegramSelectionHaptic).toHaveBeenCalledTimes(1);
  });

  it('detects elapsed hold time from touch timestamps if the WebView delays its timeout', () => {
    const { onChange, wheel } = mountControlled();
    touch(wheel, 'touchstart', 200, 100);
    // Deliberately do not advance fake timers: the WebView may delay setTimeout.
    touch(wheel, 'touchmove', 182, 385); // 285ms, 18px.
    expect(onChange).not.toHaveBeenCalled();
    touch(wheel, 'touchmove', 150, 420); // 50px = one exact kilogram.
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 281.25 });
    touch(wheel, 'touchend', 150, 450);
    flushAnimation();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(triggerTelegramSelectionHaptic).toHaveBeenCalledTimes(1);
  });

  it('keeps a long but deliberate swipe in decade mode when its first move spans 80px', () => {
    const { onChange, wheel } = mountControlled(100.5);
    touch(wheel, 'touchstart', 200, 100);
    touch(wheel, 'touchmove', 120, 500);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 120.5 });
    touch(wheel, 'touchend', 120, 550);
    flushAnimation();
    expect(onChange.mock.calls.every(([value]) => value.weightKg % 10 === 0.5)).toBe(true);
  });

  it('continues 1kg at a time across 299 -> 300 after the long hold', () => {
    const { onChange, wheel } = mountControlled(299.75);
    touch(wheel, 'touchstart', 200, 100);
    act(() => vi.advanceTimersByTime(240));
    touch(wheel, 'touchmove', 152, 370);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 300.75 });
    touch(wheel, 'touchmove', 104, 410);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 301.75 });
    touch(wheel, 'touchend', 104, 440);
    flushAnimation();
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(triggerTelegramSelectionHaptic).toHaveBeenCalledTimes(2);
  });

  it('suppresses the long-press context menu on kilogram rows without disabling exact taps', () => {
    const { onChange, wheel } = mountControlled();
    const option = within(wheel).getByRole('option', { name: '280' });
    const contextMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    fireEvent(option, contextMenu);
    expect(contextMenu.defaultPrevented).toBe(true);
    fireEvent.click(within(wheel).getByRole('option', { name: '283' }));
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 283.25 });
    expect(triggerTelegramSelectionHaptic).toHaveBeenCalledTimes(1);
  });

  it('allows a new fine hold after WebView cancels an earlier gesture', () => {
    const { onChange, wheel } = mountControlled();
    touch(wheel, 'touchstart', 200, 100);
    touch(wheel, 'touchcancel', 200, 180);
    act(() => vi.advanceTimersByTime(500));
    expect(onChange).not.toHaveBeenCalled();

    touch(wheel, 'touchstart', 200, 700);
    act(() => vi.advanceTimersByTime(240));
    touch(wheel, 'touchmove', 152, 980);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 281.25 });
    touch(wheel, 'touchend', 152, 1000);
    flushAnimation();
    expect(triggerTelegramSelectionHaptic).toHaveBeenCalledTimes(1);
  });
});
