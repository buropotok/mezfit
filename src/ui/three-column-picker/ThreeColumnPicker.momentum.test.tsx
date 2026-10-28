// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { triggerTelegramSelectionHaptic } from '../../telegram';
import { WeightRepsPicker } from '../weight-reps-picker/WeightRepsPicker';

vi.mock('../../telegram', () => ({ triggerTelegramSelectionHaptic: vi.fn() }));

const ROW_HEIGHT = 48;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;

function flushFrame(timestamp = 0) {
  const work = [...frames.values()];
  frames.clear();
  act(() => work.forEach(callback => callback(timestamp)));
}

function mountControlled(accepts = true) {
  const target = document.createElement('button');
  document.body.appendChild(target);
  const onChange = vi.fn();
  function Picker() {
    const [value, setValue] = useState({ reps: 8, weightKg: 77.5 });
    return (
      <KonstaProvider theme="ios" dark>
        <div className="k-ios dark">
          <WeightRepsPicker opened value={value} target={target}
            onChange={(next) => { onChange(next); if (accepts) setValue(next); }}
            onClose={vi.fn()} />
        </div>
      </KonstaProvider>
    );
  }
  render(<Picker />);
  flushFrame();
  return { onChange };
}

function observeNativeScroll(column: string, index: number) {
  const element = screen.getByRole('listbox', { name: column }) as HTMLDivElement;
  let position = index * ROW_HEIGHT;
  const appWrites: number[] = [];
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => position,
    set: (next: number) => { appWrites.push(next); position = next; },
  });
  Object.defineProperty(element, 'scrollTo', {
    configurable: true,
    value: ({ top }: { top: number }) => { element.scrollTop = top; },
  });
  return {
    element, appWrites,
    moveTo(nextIndex: number) {
      position = nextIndex * ROW_HEIGHT;
      fireEvent.scroll(element);
    },
  };
}

beforeEach(() => {
  frames = new Map();
  nextFrame = 1;
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

describe('three-wheel native scroll handling shared with TimePicker', () => {
  it('keeps native scroll and per-value haptics for repetitions', () => {
    const { onChange } = mountControlled();
    const reps = observeNativeScroll('Повторения', 8);
    act(() => reps.moveTo(10));
    flushFrame();
    expect(onChange).toHaveBeenLastCalledWith({ reps: 10, weightKg: 77.5 });
    act(() => reps.moveTo(12));
    flushFrame();
    expect(onChange).toHaveBeenLastCalledWith({ reps: 12, weightKg: 77.5 });
    expect(reps.appWrites).toEqual([]);
    expect(triggerTelegramSelectionHaptic).toHaveBeenCalledTimes(4);
  });

  it('uses native scrolling for the kilogram wheel with a 10kg value per row', () => {
    const { onChange } = mountControlled();
    // 77kg belongs to the 7, 17, 27, ... 397kg native snap row set.
    const kg = observeNativeScroll('Килограммы', 7);
    act(() => kg.moveTo(8));
    flushFrame();
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 87.5 });
    expect(triggerTelegramSelectionHaptic).toHaveBeenCalledTimes(1);
    expect(kg.appWrites).toEqual([]);
    expect(within(kg.element).getByRole('option', { name: '87' })
      .getAttribute('aria-selected')).toBe('true');
  });

  it('preserves native scrolling and fractional haptics', () => {
    const { onChange } = mountControlled();
    const fractions = observeNativeScroll('Доли килограмма', 2);
    act(() => fractions.moveTo(3));
    flushFrame();
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 77.75 });
    expect(triggerTelegramSelectionHaptic).toHaveBeenCalledTimes(1);
    expect(fractions.appWrites).toEqual([]);
  });

  it('reconciles rejected repetitions after 200ms without scrollend in legacy WebViews', () => {
    const { onChange } = mountControlled(false);
    const reps = observeNativeScroll('Повторения', 8);
    Object.defineProperty(reps.element, 'onscrollend', { configurable: true, value: undefined });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    act(() => reps.moveTo(10));
    flushFrame();
    expect(onChange).toHaveBeenLastCalledWith({ reps: 10, weightKg: 77.5 });
    expect(reps.appWrites).toEqual([]);
    act(() => vi.advanceTimersByTime(199));
    expect(reps.appWrites).toEqual([]);
    act(() => vi.advanceTimersByTime(1));
    flushFrame();
    expect(reps.appWrites).toContain(8 * ROW_HEIGHT);
  });

  it('uses native scrollend when available for controlled rejection', () => {
    const { onChange } = mountControlled(false);
    const reps = observeNativeScroll('Повторения', 8);
    Object.defineProperty(reps.element, 'onscrollend', { configurable: true, value: null });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    act(() => reps.moveTo(10));
    flushFrame();
    expect(onChange).toHaveBeenLastCalledWith({ reps: 10, weightKg: 77.5 });
    act(() => vi.advanceTimersByTime(500));
    expect(reps.appWrites).toEqual([]);
    fireEvent(reps.element, new Event('scrollend', { bubbles: true }));
    flushFrame();
    expect(reps.appWrites).toContain(8 * ROW_HEIGHT);
  });

  it('retains one tactile event for a direct coarse-row tap', () => {
    const { onChange } = mountControlled();
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Килограммы' }))
      .getByRole('option', { name: '307' }));
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 307.5 });
    expect(triggerTelegramSelectionHaptic).toHaveBeenCalledTimes(1);
  });
});
