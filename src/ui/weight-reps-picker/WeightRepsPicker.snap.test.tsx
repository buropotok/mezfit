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

beforeEach(() => {
  vi.mocked(triggerTelegramSelectionHaptic).mockClear();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
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

function mountControlledWeight(initialKg = 280.5) {
  const target = document.createElement('button');
  document.body.appendChild(target);
  const onChange = vi.fn();
  function Picker() {
    const [value, setValue] = useState({ reps: 8, weightKg: initialKg });
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
  return { onChange };
}

function emulateNativeWheel(column: HTMLDivElement, index: number) {
  let top = index * ROW_HEIGHT;
  const appWrites: number[] = [];
  Object.defineProperty(column, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (next: number) => { appWrites.push(next); top = next; },
  });
  Object.defineProperty(column, 'scrollTo', {
    configurable: true,
    value: ({ top: next }: { top: number }) => { column.scrollTop = next; },
  });
  return {
    appWrites,
    moveTo(logicalIndex: number) {
      top = logicalIndex * ROW_HEIGHT;
      fireEvent.scroll(column);
    },
    settle() {
      fireEvent(column, new Event('scrollend', { bubbles: true }));
    },
  };
}

describe('WeightRepsPicker stable kilogram snap', () => {
  it('uses native momentum without predictive CSS scroll snap only for kilograms', () => {
    mountControlledWeight();
    const kg = screen.getByRole('listbox', { name: 'Килограммы' });
    expect(kg.className).toContain('ui-time-picker__column--free-momentum');
    expect(kg.className).toContain('ui-time-picker__column--snap-on-end');
    expect(screen.getByRole('listbox', { name: 'Повторения' }).className)
      .not.toContain('ui-time-picker__column--snap-on-end');
    expect(screen.getByRole('listbox', { name: 'Доли килограмма' }).className)
      .not.toContain('ui-time-picker__column--snap-on-end');
  });

  it('keeps crossing feedback during momentum and aligns to the nearest number only at scrollend', () => {
    const { onChange } = mountControlledWeight();
    const kilograms = screen.getByRole('listbox', { name: 'Килограммы' }) as HTMLDivElement;
    const native = emulateNativeWheel(kilograms, 280);

    act(() => native.moveTo(314.4));
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 314.5 });
    expect(triggerTelegramSelectionHaptic).toHaveBeenCalledTimes(34);
    expect(native.appWrites).toEqual([]);

    act(() => native.settle());
    expect(native.appWrites).toEqual([314 * ROW_HEIGHT]);
    expect(within(kilograms).getByRole('option', { name: '314' })
      .getAttribute('aria-selected')).toBe('true');
    expect(triggerTelegramSelectionHaptic).toHaveBeenCalledTimes(34);
  });

  it('does not treat crossing 299 -> 300 as a special boundary', () => {
    const { onChange } = mountControlledWeight(299.25);
    const kilograms = screen.getByRole('listbox', { name: 'Килограммы' }) as HTMLDivElement;
    const native = emulateNativeWheel(kilograms, 299);
    act(() => native.moveTo(301.2));
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 301.25 });
    expect(triggerTelegramSelectionHaptic).toHaveBeenCalledTimes(2);
    act(() => native.settle());
    expect(native.appWrites).toEqual([301 * ROW_HEIGHT]);
  });

  it('leaves duration picker native scroll snapping unchanged', () => {
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
    for (const label of ['Часы продолжительности', 'Минуты продолжительности', 'Секунды продолжительности']) {
      expect(screen.getByRole('listbox', { name: label }).className)
        .not.toContain('ui-time-picker__column--snap-on-end');
    }
  });
});
