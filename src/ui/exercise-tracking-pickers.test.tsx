// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { triggerTelegramSelectionHaptic } from '../telegram';
import { DurationPicker, formatDurationSeconds } from './duration-picker/DurationPicker';
import { DistancePicker } from './distance-picker/DistancePicker';
import { WeightPicker } from './weight-picker/WeightPicker';

vi.mock('../telegram', () => ({ triggerTelegramSelectionHaptic: vi.fn() }));

interface NumericPickerProps {
  opened: boolean;
  value: number;
  onChange: (value: number) => void;
  onClose: () => void;
  target: HTMLElement | null;
}

function mountPicker(Picker: ComponentType<NumericPickerProps>, initialValue: number) {
  const target = document.createElement('button');
  document.body.appendChild(target);
  const onChange = vi.fn();
  const onClose = vi.fn();
  const ui = (opened: boolean, value: number) => (
    <KonstaProvider theme="ios" dark>
      <div className="k-ios dark">
        <Picker opened={opened} value={value} target={target} onChange={onChange} onClose={onClose} />
      </div>
    </KonstaProvider>
  );
  const result = render(ui(true, initialValue));
  return {
    onChange,
    onClose,
    rerender(opened: boolean, value: number) { result.rerender(ui(opened, value)); },
  };
}

function option(column: string, label: string) {
  return within(screen.getByRole('listbox', { name: column })).getByRole('option', { name: label });
}

function selected(column: string, label: string) {
  expect(option(column, label).getAttribute('aria-selected')).toBe('true');
}

function dismiss(dialogLabel: string) {
  const dialog = screen.getByRole('dialog', { name: dialogLabel });
  const backdrop = dialog.previousElementSibling;
  expect(backdrop).not.toBeNull();
  fireEvent.click(backdrop as Element);
}

beforeEach(() => {
  vi.mocked(triggerTelegramSelectionHaptic).mockClear();
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
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

describe('DurationPicker (elapsed time, not time of day)', () => {
  it.each([
    [0, '00:00:00', '00', '00', '00'],
    [125, '00:02:05', '00', '02', '05'],
    [86399, '23:59:59', '23', '59', '59'],
  ])('represents %i seconds exactly as %s', (value, formatted, hours, minutes, seconds) => {
    expect(formatDurationSeconds(value)).toBe(formatted);
    mountPicker(DurationPicker, value);
    selected('Часы продолжительности', hours);
    selected('Минуты продолжительности', minutes);
    selected('Секунды продолжительности', seconds);
    const lens = document.querySelector('.ui-time-picker__lens');
    expect(lens).not.toBeNull();
    expect(Array.from(lens?.querySelectorAll('text') ?? []).filter(node => node.textContent === ':')).toHaveLength(2);
    expect(lens?.getAttribute('data-ui-time-picker-lens-mode')).toBeTruthy();
  });

  it('commits one component only and never wraps elapsed hours/minutes', () => {
    const picker = mountPicker(DurationPicker, 125);
    fireEvent.click(option('Часы продолжительности', '23'));
    expect(picker.onChange).toHaveBeenLastCalledWith(82925);
    picker.rerender(true, 82925);
    fireEvent.click(option('Минуты продолжительности', '59'));
    expect(picker.onChange).toHaveBeenLastCalledWith(86345);
    picker.rerender(true, 86345);
    fireEvent.click(option('Секунды продолжительности', '59'));
    expect(picker.onChange).toHaveBeenLastCalledWith(86399);
    expect(within(screen.getByRole('listbox', { name: 'Часы продолжительности' })).getAllByRole('option')).toHaveLength(24);
  });

  it('does not mutate on opening, closing, or tapping the current value, and reopens with controlled state', () => {
    const picker = mountPicker(DurationPicker, 125);
    fireEvent.click(option('Секунды продолжительности', '05'));
    expect(picker.onChange).not.toHaveBeenCalled();
    dismiss('Выбор продолжительности');
    expect(picker.onClose).toHaveBeenCalledTimes(1);
    picker.rerender(false, 125);
    picker.rerender(true, 86399);
    selected('Часы продолжительности', '23');
    selected('Секунды продолжительности', '59');
    expect(picker.onChange).not.toHaveBeenCalled();
    fireEvent.click(option('Секунды продолжительности', '58'));
    expect(picker.onChange).toHaveBeenLastCalledWith(86398);
    expect(triggerTelegramSelectionHaptic).toHaveBeenCalledTimes(1);
  });

  it.each([-1, 86400, 1.5, NaN, Infinity])('rejects invalid seconds %s', (value) => {
    expect(() => mountPicker(DurationPicker, value)).toThrow(
      'DurationPicker value must be an integer from 0 to 86399 seconds',
    );
  });
});

describe('DistancePicker (exact meters)', () => {
  it('displays kilometers and zero-padded meters and preserves the other part', () => {
    const picker = mountPicker(DistancePicker, 2500);
    selected('Километры', '2 км');
    selected('Метры', '500 м');
    expect(document.querySelector('.ui-time-picker__lens')).not.toBeNull();
    fireEvent.click(option('Километры', '3 км'));
    expect(picker.onChange).toHaveBeenLastCalledWith(3500);
    picker.rerender(true, 3500);
    fireEvent.click(option('Метры', '050 м'));
    expect(picker.onChange).toHaveBeenLastCalledWith(3050);
  });

  it('supports 0 through 100999 meters without reducing precision', () => {
    const picker = mountPicker(DistancePicker, 100999);
    selected('Километры', '100 км');
    selected('Метры', '999 м');
    picker.rerender(true, 0);
    selected('Километры', '0 км');
    selected('Метры', '000 м');
    expect(picker.onChange).not.toHaveBeenCalled();
    fireEvent.click(option('Метры', '001 м'));
    expect(picker.onChange).toHaveBeenLastCalledWith(1);
  });

  it('does not fire on reopen or unchanged selection, and closes through the popover', () => {
    const picker = mountPicker(DistancePicker, 2050);
    selected('Метры', '050 м');
    fireEvent.click(option('Метры', '050 м'));
    picker.rerender(false, 2050);
    picker.rerender(true, 2500);
    selected('Метры', '500 м');
    dismiss('Выбор дистанции');
    expect(picker.onClose).toHaveBeenCalledTimes(1);
    expect(picker.onChange).not.toHaveBeenCalled();
  });

  it.each([-1, 101000, 1.25, NaN, Infinity])('rejects invalid meters %s', (value) => {
    expect(() => mountPicker(DistancePicker, value)).toThrow(
      'DistancePicker value must be an integer from 0 to 100999 meters',
    );
  });
});

describe('WeightPicker (standalone quarter-kilogram weight)', () => {
  it('renders two wheels with all four fractions and exact max', () => {
    const picker = mountPicker(WeightPicker, 399.75);
    selected('Килограммы', '399');
    selected('Доли килограмма', '0,75');
    expect(within(screen.getByRole('listbox', { name: 'Доли килограмма' }))
      .getAllByRole('option').map(x => x.textContent)).toEqual(['00', '25', '5', '75']);
    fireEvent.click(option('Килограммы', '70'));
    expect(picker.onChange).toHaveBeenLastCalledWith(70.75);
    picker.rerender(true, 70.75);
    fireEvent.click(option('Доли килограмма', '0,25'));
    expect(picker.onChange).toHaveBeenLastCalledWith(70.25);
  });

  it('reopens with controlled zero and never writes on non-changing actions', () => {
    const picker = mountPicker(WeightPicker, 70.75);
    picker.rerender(false, 70.75);
    picker.rerender(true, 0);
    selected('Килограммы', '0');
    selected('Доли килограмма', '0,00');
    fireEvent.click(option('Килограммы', '0'));
    dismiss('Выбор веса');
    expect(picker.onClose).toHaveBeenCalledTimes(1);
    expect(picker.onChange).not.toHaveBeenCalled();
    fireEvent.click(option('Доли килограмма', '0,5'));
    expect(picker.onChange).toHaveBeenLastCalledWith(0.5);
  });

  it.each([-0.25, 400, 399.76, NaN, Infinity])('rejects out-of-range kilograms %s', (value) => {
    expect(() => mountPicker(WeightPicker, value)).toThrow(
      'WeightPicker weightKg must be from 0 to 399.75',
    );
  });

  it.each([0.001, 70.749, 100.1])('rejects non-quarter kilogram values %s', (value) => {
    expect(() => mountPicker(WeightPicker, value)).toThrow(
      'WeightPicker weightKg must use 0.25 kg increments',
    );
  });
});
