// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WeightRepsPicker } from './WeightRepsPicker';

function renderPicker({
  value = { reps: 8, weightKg: 77.5 },
  onChange = vi.fn(),
  onClose = vi.fn(),
}: {
  value?: { reps: number; weightKg: number };
  onChange?: (value: { reps: number; weightKg: number }) => void;
  onClose?: () => void;
} = {}) {
  const target = document.createElement('button');
  document.body.appendChild(target);

  const renderResult = render(
    <KonstaProvider theme="ios" dark>
      <div className="k-ios dark">
        <WeightRepsPicker
          opened
          target={target}
          value={value}
          onChange={onChange}
          onClose={onClose}
        />
      </div>
    </KonstaProvider>,
  );

  return {
    onChange,
    onClose,
    ...renderResult,
  };
}

beforeEach(() => {
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
});

describe('WeightRepsPicker', () => {
  it('renders the approved two-part layout with three independent wheels', () => {
    renderPicker();

    expect(screen.getByText('Повторения').className).toContain('ui-text--footnote');
    expect(screen.getByText('Вес').className).toContain('ui-text--footnote');

    const reps = screen.getByRole('listbox', { name: 'Повторения' });
    const kilograms = screen.getByRole('listbox', { name: 'Килограммы' });
    const fraction = screen.getByRole('listbox', { name: 'Доли килограмма' });

    expect(within(reps).getByRole('option', { name: '8' }).getAttribute('aria-selected')).toBe('true');
    expect(within(kilograms).getByRole('option', { name: '77' }).getAttribute('aria-selected')).toBe('true');
    expect(within(fraction).getByRole('option', { name: '0,5' }).getAttribute('aria-selected')).toBe('true');

    const columns = reps.parentElement;
    expect(columns?.className).toContain('ui-weight-reps-picker__columns');
    const comma = screen.getByText(',');
    expect(comma.getAttribute('x')).toBe('216');
    expect(comma.closest('.ui-time-picker__lens')).not.toBeNull();
  });

  it('emits repetitions while preserving the selected weight', () => {
    const onChange = vi.fn();
    renderPicker({ onChange });

    fireEvent.click(
      within(screen.getByRole('listbox', { name: 'Повторения' }))
        .getByRole('option', { name: '12' }),
    );

    expect(onChange).toHaveBeenLastCalledWith({ reps: 12, weightKg: 77.5 });
  });

  it('combines kilogram units and the selected fractional part', () => {
    const onChange = vi.fn();
    renderPicker({ value: { reps: 8, weightKg: 77.5 }, onChange });

    fireEvent.click(
      within(screen.getByRole('listbox', { name: 'Доли килограмма' }))
        .getByRole('option', { name: '0,25' }),
    );

    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 77.25 });
  });

  it('uses exactly the requested fractional values', () => {
    renderPicker();

    const fraction = screen.getByRole('listbox', { name: 'Доли килограмма' });
    const options = within(fraction).getAllByRole('option');

    expect(options.map((option) => option.textContent)).toEqual(['00', '25', '5']);
  });

  it('rejects values outside the component contract', () => {
    expect(() => renderPicker({ value: { reps: 101, weightKg: 80 } })).toThrow(
      'WeightRepsPicker reps must be an integer from 0 to 100',
    );
    expect(() => renderPicker({ value: { reps: 8, weightKg: 80.75 } })).toThrow(
      'WeightRepsPicker weightKg must use 0, 0.25 or 0.5 fractions',
    );
  });
});
