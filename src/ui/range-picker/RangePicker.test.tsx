// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RangePicker,
  applyRangePickerPart,
  assertResistanceRange,
} from './RangePicker';

const picker = vi.hoisted(() => ({ onChange: null as null | ((value: { left: number; right: number }) => void) }));
vi.mock('../two-column-picker/TwoColumnPicker', () => ({
  TwoColumnPicker: (props: {
    opened: boolean;
    value: { left: number; right: number };
    columns: readonly [{ values: readonly number[] }, { values: readonly number[] }];
    geometry: string;
    ariaLabel: string;
    onChange: (value: { left: number; right: number }) => void;
    footer?: ReactNode;
  }) => {
    picker.onChange = props.onChange;
    return <div role="dialog" aria-label={props.ariaLabel}>
      <span>{props.value.left}–{props.value.right}</span>
      <span data-testid="wheel-geometry">{props.geometry}</span>
      <span data-testid="wheel-range">{props.columns[0].values[0]}–{props.columns[1].values.at(-1)}</span>
      {props.footer}
      <button onClick={() => props.onChange({ left: 21, right: props.value.right })}>Установить минимум</button>
      <button onClick={() => props.onChange({ left: props.value.left, right: 3 })}>Установить максимум</button>
    </div>;
  },
}));

afterEach(() => { cleanup(); picker.onChange = null; });

describe('RangePicker UIkit primitive', () => {
  it('reuses TimePicker wheel geometry without changing the interaction', () => {
    const onChange = vi.fn();
    const view = render(<RangePicker opened value={{ min: 2, max: 5 }} target={null} onChange={onChange} onClose={() => {}} />);
    expect(screen.getByTestId('wheel-geometry').textContent).toBe('compact-time');
    expect(screen.getByTestId('wheel-range').textContent).toBe('1–30');
    fireEvent.click(screen.getByRole('button', { name: 'Установить минимум' }));
    expect(onChange).toHaveBeenCalledWith({ min: 21, max: 21 });
    // A distinct interaction starts with fresh wheel state and props.
    view.unmount();
    render(<RangePicker opened value={{ min: 2, max: 5 }} target={null} onChange={onChange} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Установить максимум' }));
    expect(onChange).toHaveBeenCalledWith({ min: 2, max: 3 });
  });

  it('keeps the right wheel active through repeated crossed-range updates and a deferred normalization', () => {
    const onChange = vi.fn();
    const close = vi.fn();
    const view = render(<RangePicker opened value={{ min: 10, max: 13 }} target={null} onChange={onChange} onClose={close} />);
    act(() => { picker.onChange?.({ left: 10, right: 9 }); });
    expect(onChange).toHaveBeenLastCalledWith({ min: 9, max: 9 });
    view.rerender(<RangePicker opened value={{ min: 9, max: 9 }} target={null} onChange={onChange} onClose={close} />);
    // Native wheel can continue emitting old left=10 while the right wheel is in motion.
    act(() => { picker.onChange?.({ left: 10, right: 8 }); });
    expect(onChange).toHaveBeenLastCalledWith({ min: 8, max: 8 });
    view.rerender(<RangePicker opened value={{ min: 8, max: 8 }} target={null} onChange={onChange} onClose={close} />);
    // Deferred normalized props may land between two right-wheel events.
    act(() => { picker.onChange?.({ left: 8, right: 7 }); });
    expect(onChange).toHaveBeenLastCalledWith({ min: 7, max: 7 });
  });

  it('exposes configurable min/max and renders the supplied footer beneath the wheels', () => {
    render(<RangePicker opened value={{ min: 4, max: 11 }} target={null}
      minAllowed={1} maxAllowed={30} onChange={() => {}} onClose={() => {}}
      footer={<button>Выбрать цвет</button>} />);
    expect(screen.getByTestId('wheel-range').textContent).toBe('1–30');
    expect(screen.getByRole('button', { name: 'Выбрать цвет' })).toBeTruthy();
  });

  it('rejects invalid ranges while allowing equal endpoints', () => {
    expect(() => assertResistanceRange({ min: 1, max: 1 })).not.toThrow();
    expect(() => assertResistanceRange({ min: 30, max: 30 })).not.toThrow();
    for (const invalid of [{ min: 0, max: 10 }, { min: 11, max: 10 }, { min: 10, max: 31 }]) {
      expect(() => assertResistanceRange(invalid)).toThrow('INVALID_RESISTANCE_RANGE');
    }
    expect(applyRangePickerPart({ min: 20, max: 25 }, 'right', 8)).toEqual({ min: 8, max: 8 });
  });
});
