// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { triggerTelegramSelectionHaptic } from '../../telegram';
import { WeightRepsPicker } from '../weight-reps-picker/WeightRepsPicker';

vi.mock('../../telegram', () => ({ triggerTelegramSelectionHaptic: vi.fn() }));

const ROW_HEIGHT = 48;

function mountControlled() {
  const target = document.createElement('button');
  document.body.appendChild(target);
  const onChange = vi.fn();
  function ControlledPicker() {
    const [value, setValue] = useState({ reps: 8, weightKg: 77.5 });
    return (
      <KonstaProvider theme="ios" dark>
        <div className="k-ios dark">
          <WeightRepsPicker
            opened
            value={value}
            target={target}
            onChange={(next) => { onChange(next); setValue(next); }}
            onClose={vi.fn()}
          />
        </div>
      </KonstaProvider>
    );
  }
  render(<ControlledPicker />);
  return { onChange };
}

function mountUnacknowledged() {
  const target = document.createElement('button');
  document.body.appendChild(target);
  const onChange = vi.fn();
  render(
    <KonstaProvider theme="ios" dark>
      <div className="k-ios dark">
        <WeightRepsPicker
          opened
          value={{ reps: 8, weightKg: 77.5 }}
          target={target}
          onChange={onChange}
          onClose={vi.fn()}
        />
      </div>
    </KonstaProvider>,
  );
  return { onChange };
}

function observeNativeScroll(column: string, initialIndex: number) {
  const element = screen.getByRole('listbox', { name: column }) as HTMLDivElement;
  let nativePosition = initialIndex * ROW_HEIGHT;
  const appWrites: number[] = [];
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => nativePosition,
    set: (value: number) => {
      appWrites.push(value);
      nativePosition = value;
    },
  });
  return {
    element,
    appWrites,
    moveTo(index: number) {
      // Directly update browser-owned scrollTop without going through its setter.
      nativePosition = index * ROW_HEIGHT;
      fireEvent.scroll(element);
    },
  };
}

beforeEach(() => {
  vi.mocked(triggerTelegramSelectionHaptic).mockClear();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('three-wheel native inertia with per-value feedback', () => {
  it('does not steer the kilogram scroll position when parent accepts each frame', () => {
    const { onChange } = mountControlled();
    const kilograms = observeNativeScroll('Килограммы', 77);
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextFrame = 2;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const id = nextFrame++;
      callbacks.set(id, cb);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { callbacks.delete(id); });
    const flush = () => {
      const work = [...callbacks.entries()];
      callbacks.clear();
      work.forEach(([, callback]) => callback(0));
    };

    act(() => { kilograms.moveTo(78); flush(); });
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 78.5 });
    act(() => {
      kilograms.moveTo(80);
      kilograms.moveTo(83);
      flush();
    });
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 83.5 });
    expect(kilograms.appWrites).toEqual([]);
    expect(within(kilograms.element).getByRole('option', { name: '83' })
      .getAttribute('aria-selected')).toBe('true');
    // 77 -> 78 (1), 78 -> 80 (2), 80 -> 83 (3).
    expect(triggerTelegramSelectionHaptic).toHaveBeenCalledTimes(6);
  });

  it('preserves an in-flight kilogram choice while reps scroll before parent acknowledges', () => {
    const { onChange } = mountUnacknowledged();
    const kilograms = observeNativeScroll('Килограммы', 77);
    const repetitions = observeNativeScroll('Повторения', 8);
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextFrame = 2;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const id = nextFrame++;
      callbacks.set(id, cb);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { callbacks.delete(id); });

    act(() => {
      kilograms.moveTo(80);
      repetitions.moveTo(10);
      const work = [...callbacks.values()];
      callbacks.clear();
      work.forEach(callback => callback(0));
    });

    expect(onChange).toHaveBeenLastCalledWith({ reps: 10, weightKg: 80.5 });
    expect(kilograms.appWrites).toEqual([]);
    expect(repetitions.appWrites).toEqual([]);
    expect(triggerTelegramSelectionHaptic).toHaveBeenCalledTimes(5);
  });

  it('keeps a direct tap to a distant value as one tactile selection, not hundreds of ticks', () => {
    mountUnacknowledged();
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Килограммы' }))
      .getByRole('option', { name: '300' }));
    expect(triggerTelegramSelectionHaptic).toHaveBeenCalledTimes(1);
  });
});
