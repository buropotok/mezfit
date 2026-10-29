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

function observeNativeFractions(index: number) {
  const element = screen.getByRole('listbox', { name: 'Доли килограмма' }) as HTMLDivElement;
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

function closePicker() {
  const dialog = screen.getByRole('dialog', { name: 'Повторения и вес' });
  fireEvent.click(dialog.previousElementSibling as Element);
}

describe('three-column static lens slots preserve the native fraction wheel', () => {
  it('removes repetition and integer weight listboxes, leaving one native wheel', () => {
    mountControlled();
    expect(screen.queryByRole('listbox', { name: 'Повторения' })).toBeNull();
    expect(screen.queryByRole('listbox', { name: 'Килограммы' })).toBeNull();
    const fractions = screen.getByRole('listbox', { name: 'Доли килограмма' });
    expect(within(fractions).getAllByRole('option')).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Изменить повторения' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Изменить целые килограммы' })).toBeTruthy();
  });

  it('retains native fraction scrolling without Telegram haptics', () => {
    const { onChange } = mountControlled();
    const wheel = observeNativeFractions(2);
    act(() => wheel.moveTo(3));
    flushFrame();
    expect(onChange).not.toHaveBeenCalled();
    expect(triggerTelegramSelectionHaptic).not.toHaveBeenCalled();
    expect(wheel.appWrites).toEqual([]);
    closePicker();
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ reps: 8, weightKg: 77.75 });
  });

  it('retains the local fraction draft after the 200ms fallback in legacy WebViews', () => {
    const { onChange } = mountControlled(false);
    const wheel = observeNativeFractions(2);
    Object.defineProperty(wheel.element, 'onscrollend', { configurable: true, value: undefined });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    act(() => wheel.moveTo(3));
    flushFrame();
    expect(onChange).not.toHaveBeenCalled();
    expect(wheel.appWrites).toEqual([]);
    act(() => vi.advanceTimersByTime(199));
    expect(wheel.appWrites).toEqual([]);
    act(() => vi.advanceTimersByTime(1));
    flushFrame();
    expect(wheel.appWrites).toEqual([]);
    expect(wheel.element.scrollTop).toBe(3 * ROW_HEIGHT);
    closePicker();
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ reps: 8, weightKg: 77.75 });
  });

  it('retains the local fraction draft after scrollend on modern WebViews', () => {
    const { onChange } = mountControlled(false);
    const wheel = observeNativeFractions(2);
    Object.defineProperty(wheel.element, 'onscrollend', { configurable: true, value: null });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    act(() => wheel.moveTo(3));
    flushFrame();
    expect(onChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(500));
    expect(wheel.appWrites).toEqual([]);
    fireEvent(wheel.element, new Event('scrollend', { bubbles: true }));
    flushFrame();
    expect(wheel.appWrites).toEqual([]);
    expect(wheel.element.scrollTop).toBe(3 * ROW_HEIGHT);
    closePicker();
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ reps: 8, weightKg: 77.75 });
  });

  it('keeps direct fraction taps independent of the numeric sheet actions', () => {
    const { onChange } = mountControlled();
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Доли килограмма' }))
      .getByRole('option', { name: '0,25' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(triggerTelegramSelectionHaptic).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Ввод повторений' })).toBeNull();
    closePicker();
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ reps: 8, weightKg: 77.25 });
  });
});
