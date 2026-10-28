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
  const result = render(
    <KonstaProvider theme="ios" dark>
      <div className="k-ios dark">
        <WeightRepsPicker opened target={target} value={value}
          onChange={onChange} onClose={onClose} />
      </div>
    </KonstaProvider>,
  );

  return {
    onChange,
    onClose,
    target,
    ...result,
    setValue(next: { reps: number; weightKg: number }, opened = true) {
      result.rerender(
        <KonstaProvider theme="ios" dark>
          <div className="k-ios dark">
            <WeightRepsPicker opened={opened} target={target} value={next}
              onChange={onChange} onClose={onClose} />
          </div>
        </KonstaProvider>,
      );
    },
  };
}

function enter(...digits: string[]) {
  for (const digit of digits) {
    fireEvent.click(screen.getByRole('button', { name: `Цифра ${digit}` }));
  }
}

beforeEach(() => {
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
  Reflect.deleteProperty(HTMLElement.prototype, 'animate');
  window.localStorage.removeItem('mezfit.glassSettings');
  document.body.innerHTML = '';
});

describe('WeightRepsPicker numeric lens editor', () => {
  it('renders only the fractional wheel and two actionable pencil-plus icons inside the lens', () => {
    renderPicker();
    expect(screen.getByText('Повторения').className).toContain('ui-text--footnote');
    expect(screen.getByText('Вес').className).toContain('ui-text--footnote');
    expect(screen.queryByRole('listbox', { name: 'Повторения' })).toBeNull();
    expect(screen.queryByRole('listbox', { name: 'Килограммы' })).toBeNull();
    const fraction = screen.getByRole('listbox', { name: 'Доли килограмма' });
    expect(within(fraction).getByRole('option', { name: '0,5' })
      .getAttribute('aria-selected')).toBe('true');
    const lens = document.querySelector('.ui-time-picker__lens');
    expect(lens?.querySelectorAll('.ui-time-picker__lens-action-slot')).toHaveLength(2);
    expect(within(lens as HTMLElement).getByRole('button', { name: 'Изменить повторения' })).toBeTruthy();
    expect(within(lens as HTMLElement).getByRole('button', { name: 'Изменить целые килограммы' })).toBeTruthy();
    const fractionTexts = lens?.querySelectorAll('.ui-time-picker__lens-text');
    expect(fractionTexts).toHaveLength(3); // Prev/current/next of the sole remaining wheel.
    expect(Array.from(fractionTexts ?? []).every(node => node.getAttribute('x') === '240')).toBe(true);
    expect(lens?.querySelectorAll('.ui-weight-reps-picker__input-active')).toHaveLength(0);
    expect(Array.from(lens?.querySelectorAll('.ui-weight-reps-picker__lens-value') ?? [])
      .map(node => node.textContent)).toEqual(['8', '77']);
  });

  it('keeps a closed picker out of the accessibility and interaction tree', () => {
    const picker = renderPicker();
    picker.setValue({ reps: 8, weightKg: 77.5 }, false);
    expect(screen.queryByRole('button', { name: 'Изменить повторения' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Изменить целые килограммы' })).toBeNull();
    const hidden = document.querySelector('.ui-time-picker__popover');
    expect(hidden?.getAttribute('aria-hidden')).toBe('true');
    expect(hidden?.hasAttribute('inert')).toBe(true);

    picker.setValue({ reps: 8, weightKg: 77.5 }, true);
    expect(screen.getByRole('button', { name: 'Изменить повторения' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Изменить целые килограммы' })).toBeTruthy();
    expect(hidden?.hasAttribute('inert')).toBe(false);
  });

  it('opens the Konsta sheet and immediately swaps the chosen pencil for a blinking letter-i', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Изменить повторения' }));
    const sheet = screen.getByRole('dialog', { name: 'Ввод повторений' });
    expect(sheet.className).toContain('ui-mezfit-bottom-sheet');
    expect(sheet.className).toContain('ui-mezfit-bottom-sheet--above-popover');
    const lens = document.querySelector('.ui-time-picker__lens');
    expect(lens?.querySelectorAll('.ui-weight-reps-picker__input-active')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Изменить повторения' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Изменить целые килограммы' })).toHaveProperty('disabled', true);
    expect(within(sheet).getByRole('button', { name: 'Отменить' }).className).toContain('k-button');
    const save = within(sheet).getByRole('button', { name: 'Сохранить' });
    expect(save.className).toContain('ui-button--primary');
    expect(save.className).not.toContain('ui-button--color-blue');
    expect(sheet.querySelector('.ui-weight-reps-picker__number-readout')).toBeNull();
    expect(within(sheet).queryByText('8')).toBeNull();
  });

  it('lays out twelve built-in FABs with clear, zero and backspace on the fourth row', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Изменить повторения' }));
    const sheet = screen.getByRole('dialog', { name: 'Ввод повторений' });
    const fabs = within(sheet).getAllByRole('button', { name: /^Цифра / });
    expect(fabs).toHaveLength(10);
    expect(fabs.map(fab => fab.getAttribute('aria-label'))).toEqual(
      ['Цифра 1', 'Цифра 2', 'Цифра 3', 'Цифра 4', 'Цифра 5',
        'Цифра 6', 'Цифра 7', 'Цифра 8', 'Цифра 9', 'Цифра 0'],
    );
    const controls = within(sheet).getAllByRole('button')
      .filter(button => button.className.includes('ui-fab'));
    expect(controls).toHaveLength(12);
    expect(controls.map(button => button.getAttribute('aria-label')).slice(-3))
      .toEqual(['Очистить ввод', 'Цифра 0', 'Стереть последнюю цифру']);
    expect(controls.every(button => button.className.includes('ui-fab'))).toBe(true);
    expect(fabs[9].parentElement?.className).toContain('ui-weight-reps-picker__number-cell--zero');
  });

  it('clears only the active number and can backspace one digit without affecting the other field', () => {
    const picker = renderPicker({ value: { reps: 8, weightKg: 236.75 } });
    fireEvent.click(screen.getByRole('button', { name: 'Изменить целые килограммы' }));
    fireEvent.click(screen.getByRole('button', { name: 'Очистить ввод' }));
    expect(screen.getByRole('button', { name: 'Сохранить' })).toHaveProperty('disabled', true);
    enter('1', '2', '3');
    fireEvent.click(screen.getByRole('button', { name: 'Стереть последнюю цифру' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(picker.onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 12.75 });
    expect(picker.onClose).toHaveBeenCalledOnce();
    picker.setValue({ reps: 8, weightKg: 12.75 }, false);
    picker.setValue({ reps: 8, weightKg: 12.75 });
    fireEvent.click(screen.getByRole('button', { name: 'Изменить повторения' }));
    fireEvent.click(screen.getByRole('button', { name: 'Стереть последнюю цифру' }));
    expect(screen.getByRole('button', { name: 'Сохранить' })).toHaveProperty('disabled', true);
    enter('2');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(picker.onChange).toHaveBeenLastCalledWith({ reps: 2, weightKg: 12.75 });
  });

  it('fits the keypad to the free area below the native picker and input card', () => {
    const picker = renderPicker();
    const popover = document.querySelector('.ui-weight-reps-picker__popover') as HTMLElement;
    vi.spyOn(popover, 'getBoundingClientRect').mockReturnValue({ bottom: 360 } as DOMRect);
    vi.spyOn(picker.target, 'getBoundingClientRect').mockReturnValue({ bottom: 440 } as DOMRect);
    vi.stubGlobal('visualViewport', undefined);
    vi.stubGlobal('innerHeight', 700);
    fireEvent.click(screen.getByRole('button', { name: 'Изменить повторения' }));
    const sheet = screen.getByRole('dialog', { name: 'Ввод повторений' });
    expect(sheet.style.getPropertyValue('--ui-weight-reps-number-sheet-max-height')).toBe('248px');
    vi.stubGlobal('innerHeight', 620);
    fireEvent(window, new Event('resize'));
    expect(sheet.style.getPropertyValue('--ui-weight-reps-number-sheet-max-height')).toBe('168px');
    expect(sheet.querySelector('.ui-weight-reps-picker__number-readout')).toBeNull();
  });

  it('renders the number FABs with the currently selected app glass preset', () => {
    window.localStorage.setItem('mezfit.glassSettings', JSON.stringify({
      preset: 'clear', optics: false, blur: 2,
    }));
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Изменить целые килограммы' }));
    const one = screen.getByRole('button', { name: 'Цифра 1' });
    expect(one.style.getPropertyValue('--ui-glass-surface-blur')).toBe('2px');
  });

  it('reuses the FAB built-in 1.5x grow-and-return press animation', () => {
    const animation = vi.fn().mockReturnValue({ cancel: vi.fn() });
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value: animation,
    });
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Изменить повторения' }));
    const key = screen.getByRole('button', { name: 'Цифра 1' });
    fireEvent.pointerDown(key);
    expect(animation).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ scale: '1.5' })]),
      expect.objectContaining({ duration: 530 }),
    );
  });

  it('saves a digit sequence without showing it in the sheet, closes both overlays and exposes it on the lens', () => {
    const onChange = vi.fn();
    const picker = renderPicker({ onChange });
    fireEvent.click(screen.getByRole('button', { name: 'Изменить повторения' }));
    enter('1', '2');
    const sheet = screen.getByRole('dialog', { name: 'Ввод повторений' });
    expect(within(sheet).queryByText('12')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Сохранить' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ reps: 12, weightKg: 77.5 });
    expect(screen.queryByRole('dialog', { name: 'Ввод повторений' })).toBeNull();
    expect(picker.onClose).toHaveBeenCalledOnce();
    // Controlled parent accepts the value and closes the picker, then it can reopen.
    picker.setValue({ reps: 12, weightKg: 77.5 }, false);
    expect(screen.queryByRole('dialog', { name: 'Повторения и вес' })).toBeNull();
    picker.setValue({ reps: 12, weightKg: 77.5 });
    expect(document.querySelector('.ui-weight-reps-picker__lens-value')?.textContent).toBe('12');
  });

  it('cancels edits without changing the controlled value and restores the pencil icon', () => {
    const onChange = vi.fn();
    renderPicker({ onChange });
    fireEvent.click(screen.getByRole('button', { name: 'Изменить целые килограммы' }));
    enter('1', '2', '3');
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Ввод килограммов' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Изменить целые килограммы' })).toBeTruthy();
    expect(document.querySelectorAll('.ui-weight-reps-picker__input-active')).toHaveLength(0);
  });

  it('saves integer kilograms without changing fractions and displays the new value after reopening', () => {
    const onChange = vi.fn();
    const picker = renderPicker({ value: { reps: 9, weightKg: 77.75 }, onChange });
    fireEvent.click(screen.getByRole('button', { name: 'Изменить целые килограммы' }));
    enter('2', '3');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(onChange).toHaveBeenLastCalledWith({ reps: 9, weightKg: 23.75 });
    expect(picker.onClose).toHaveBeenCalledOnce();
    picker.setValue({ reps: 9, weightKg: 23.75 }, false);
    picker.setValue({ reps: 9, weightKg: 23.75 });
    expect(Array.from(document.querySelectorAll('.ui-weight-reps-picker__lens-value'))
      .map(node => node.textContent)).toEqual(['9', '23']);
  });

  it('keeps the native fractional wheel and emits changes without opening the keypad', () => {
    const onChange = vi.fn();
    renderPicker({ onChange });
    const fractions = screen.getByRole('listbox', { name: 'Доли килограмма' });
    expect(within(fractions).getAllByRole('option').map(option => option.textContent))
      .toEqual(['00', '25', '5', '75']);
    fireEvent.click(within(fractions).getByRole('option', { name: '0,25' }));
    expect(onChange).toHaveBeenLastCalledWith({ reps: 8, weightKg: 77.25 });
    expect(screen.queryByRole('dialog', { name: 'Ввод килограммов' })).toBeNull();
  });

  it('allows more than 100 repetitions and 399 kilograms without a business maximum', () => {
    const onChange = vi.fn();
    const picker = renderPicker({ onChange });
    fireEvent.click(screen.getByRole('button', { name: 'Изменить повторения' }));
    enter('1', '0', '0', '1');
    expect(screen.getByRole('button', { name: 'Сохранить' })).toHaveProperty('disabled', false);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(onChange).toHaveBeenLastCalledWith({ reps: 1001, weightKg: 77.5 });
    picker.setValue({ reps: 1001, weightKg: 77.5 }, false);
    picker.setValue({ reps: 1001, weightKg: 77.5 });
    fireEvent.click(screen.getByRole('button', { name: 'Изменить целые килограммы' }));
    enter('4', '0', '0', '0');
    expect(screen.getByRole('button', { name: 'Сохранить' })).toHaveProperty('disabled', false);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(onChange).toHaveBeenLastCalledWith({ reps: 1001, weightKg: 4000.5 });
  });
  it('preserves fractional precision on larger controlled values', () => {
    const onChange = vi.fn();
    const picker = renderPicker({ value: { reps: 101, weightKg: 400.75 }, onChange });
    expect(within(screen.getByRole('listbox', { name: 'Доли килограмма' }))
      .getByRole('option', { name: '0,75' }).getAttribute('aria-selected')).toBe('true');
    picker.setValue({ reps: 8, weightKg: 70.25 }, false);
    picker.setValue({ reps: 8, weightKg: 70.25 }, true);
    fireEvent.click(screen.getByRole('button', { name: 'Изменить целые килограммы' }));
    expect(Array.from(document.querySelectorAll('.ui-weight-reps-picker__lens-value'))
      .map(node => node.textContent)).toEqual(['8', '70']);
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('closes an active numeric sheet when its owning picker is dismissed', () => {
    const onChange = vi.fn();
    const picker = renderPicker({ onChange });
    fireEvent.click(screen.getByRole('button', { name: 'Изменить повторения' }));
    enter('1', '2');
    picker.setValue({ reps: 8, weightKg: 77.5 }, false);
    expect(screen.queryByRole('dialog', { name: 'Ввод повторений' })).toBeNull();
    picker.setValue({ reps: 8, weightKg: 77.5 }, true);
    expect(screen.getByRole('button', { name: 'Изменить повторения' })).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('saves the zero digit as a valid explicit integer', () => {
    const onChange = vi.fn();
    renderPicker({ onChange });
    fireEvent.click(screen.getByRole('button', { name: 'Изменить повторения' }));
    enter('0');
    expect(screen.getByRole('button', { name: 'Сохранить' })
      .hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(onChange).toHaveBeenLastCalledWith({ reps: 0, weightKg: 77.5 });
  });

  it('rejects negative or imprecise numbers without imposing a business maximum', () => {
    expect(() => renderPicker({ value: { reps: -1, weightKg: 80 } }))
      .toThrow('WeightRepsPicker reps must be a non-negative safe integer');
    expect(() => renderPicker({ value: { reps: 1.5, weightKg: 80 } }))
      .toThrow('WeightRepsPicker reps must be a non-negative safe integer');
    expect(() => renderPicker({ value: { reps: 8, weightKg: -0.25 } }))
      .toThrow('WeightRepsPicker weightKg must be non-negative');
    expect(() => renderPicker({ value: { reps: 8, weightKg: 80.125 } }))
      .toThrow('WeightRepsPicker weightKg must use 0.25 kg increments');
  });
});
