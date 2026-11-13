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
    onChange, onClose, target, ...result,
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

function openInput(field: 'reps' | 'kilograms' = 'reps') {
  fireEvent.click(screen.getByRole('button', {
    name: field === 'reps' ? 'Изменить повторения' : 'Изменить целые килограммы',
  }));
  return screen.getByRole('textbox', {
    name: field === 'reps' ? 'Ввести повторения' : 'Ввести целые килограммы',
  }) as HTMLInputElement;
}

function setDigits(value: string) {
  const input = screen.getByRole('textbox', { name: /^Ввести / });
  fireEvent.change(input, { target: { value } });
}

function save() {
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
}

function dismiss() {
  const picker = screen.getByRole('dialog', { name: 'Повторения и вес' });
  fireEvent.click(picker.previousElementSibling as Element);
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
  document.body.innerHTML = '';
});

describe('WeightRepsPicker native numeric entry', () => {
  it('keeps the original lens values and quarter-kilogram wheel', () => {
    renderPicker();
    expect(screen.getByText('Повторения').className).toContain('ui-text--footnote');
    expect(document.querySelector('[data-ui-picker-static-value="first"] text')?.textContent).toBe('8');
    expect(document.querySelector('[data-ui-picker-static-value="second"] text')?.textContent).toBe('77');
    expect(within(screen.getByRole('listbox', { name: 'Доли килограмма' }))
      .getByRole('option', { name: '0,5' }).getAttribute('aria-selected')).toBe('true');
  });

  it('focuses a real editable input on the same tap and requests the OS numeric keyboard', () => {
    renderPicker();
    const input = openInput();
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('8');
    expect(input.getAttribute('type')).toBe('text');
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.getAttribute('pattern')).toBe('[0-9]*');
    expect(input.getAttribute('enterkeyhint')).toBe('done');
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(1);
    expect(screen.queryByRole('dialog', { name: 'Ввод повторений' })).toBeNull();
    expect(document.querySelectorAll('.ui-fab')).toHaveLength(0);
  });

  it('uses native editing and Backspace while retaining the lens preview until Save', () => {
    const picker = renderPicker();
    const input = openInput();
    setDigits('123');
    expect(input.value).toBe('123');
    expect(document.querySelector('[data-ui-picker-static-value="first"] text')?.textContent).toBe('123');
    fireEvent.change(input, { target: { value: '12' } }); // system Backspace
    expect(input.value).toBe('12');
    expect(picker.onChange).not.toHaveBeenCalled();
    save();
    expect(picker.onChange).toHaveBeenCalledExactlyOnceWith({ reps: 12, weightKg: 77.5 });
    expect(picker.onClose).toHaveBeenCalledOnce();
  });

  it('supports keyboard Done/Enter as a save gesture', () => {
    const picker = renderPicker();
    const input = openInput('kilograms');
    setDigits('23');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(picker.onChange).toHaveBeenCalledExactlyOnceWith({ reps: 8, weightKg: 23.5 });
    expect(picker.onClose).toHaveBeenCalledOnce();
  });

  it('rejects non-digit text and never commits empty or unsafe numbers', () => {
    const picker = renderPicker();
    const input = openInput();
    setDigits('1-2');
    expect(input.value).toBe('8');
    setDigits('8.5');
    expect(input.value).toBe('8');
    setDigits('');
    expect(screen.getByRole('button', { name: 'Сохранить' })).toHaveProperty('disabled', true);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(picker.onChange).not.toHaveBeenCalled();
    setDigits('9007199254740992');
    expect(screen.getByRole('button', { name: 'Сохранить' })).toHaveProperty('disabled', true);
    setDigits('1001');
    expect(screen.getByRole('button', { name: 'Сохранить' })).toHaveProperty('disabled', false);
    save();
    expect(picker.onChange).toHaveBeenCalledExactlyOnceWith({ reps: 1001, weightKg: 77.5 });
  });

  it('blocks saving if an earlier field has an unfinished empty draft', () => {
    const picker = renderPicker();
    openInput();
    setDigits('');
    openInput('kilograms');
    setDigits('23');
    expect(screen.getByRole('button', { name: 'Сохранить' })).toHaveProperty('disabled', true);
    expect(picker.onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    expect(picker.onChange).not.toHaveBeenCalled();
    expect(picker.onClose).toHaveBeenCalledOnce();
  });

  it('ignores repeat Save after the session has already committed', () => {
    const picker = renderPicker();
    openInput();
    setDigits('12');
    save();
    save();
    expect(picker.onChange).toHaveBeenCalledExactlyOnceWith({ reps: 12, weightKg: 77.5 });
    expect(picker.onClose).toHaveBeenCalledOnce();
  });

  it('keeps independent drafts when switching from reps to kilograms', () => {
    const picker = renderPicker({ value: { reps: 8, weightKg: 77.75 } });
    openInput();
    setDigits('12');
    const kilograms = openInput('kilograms');
    expect(document.activeElement).toBe(kilograms);
    setDigits('23');
    expect(document.querySelector('[data-ui-picker-static-value="first"] text')?.textContent).toBe('12');
    expect(document.querySelector('[data-ui-picker-static-value="second"] text')?.textContent).toBe('23');
    const reps = openInput();
    expect(reps.value).toBe('12');
    expect(reps.selectionEnd).toBe(2);
    save();
    expect(picker.onChange).toHaveBeenCalledExactlyOnceWith({ reps: 12, weightKg: 23.75 });
  });

  it('cancels the entire draft without committing it', () => {
    const picker = renderPicker();
    openInput('kilograms');
    setDigits('23');
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    expect(picker.onChange).not.toHaveBeenCalled();
    expect(picker.onClose).toHaveBeenCalledOnce();
    picker.setValue({ reps: 8, weightKg: 77.5 }, false);
    picker.setValue({ reps: 8, weightKg: 77.5 });
    expect(document.querySelector('[data-ui-picker-static-value="second"] text')?.textContent).toBe('77');
  });

  it('retains whole kilograms and fractions independently, including beyond the wheel range', () => {
    const picker = renderPicker({ value: { reps: 101, weightKg: 400.75 } });
    expect(within(screen.getByRole('listbox', { name: 'Доли килограмма' }))
      .getByRole('option', { name: '0,75' }).getAttribute('aria-selected')).toBe('true');
    openInput('kilograms');
    setDigits('4000');
    save();
    expect(picker.onChange).toHaveBeenCalledExactlyOnceWith({ reps: 101, weightKg: 4000.75 });
  });

  it('preserves fractional wheel selection on normal picker dismissal', () => {
    const picker = renderPicker();
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Доли килограмма' }))
      .getByRole('option', { name: '0,25' }));
    expect(picker.onChange).not.toHaveBeenCalled();
    dismiss();
    expect(picker.onChange).toHaveBeenCalledExactlyOnceWith({ reps: 8, weightKg: 77.25 });
  });

  it('preserves numeric drafts when switching to wheels and back', () => {
    const picker = renderPicker();
    openInput();
    setDigits('15');
    fireEvent.click(screen.getByRole('button', { name: 'Режим' }));
    expect(screen.queryByRole('textbox', { name: /^Ввести / })).toBeNull();
    expect(within(screen.getByRole('listbox', { name: 'Повторения' }))
      .getByRole('option', { name: '15' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Режим' }));
    expect(document.querySelector('[data-ui-picker-static-value="first"] text')?.textContent).toBe('15');
    dismiss();
    expect(picker.onChange).toHaveBeenCalledExactlyOnceWith({ reps: 15, weightKg: 77.5 });
  });

  it('does not invent zero for missing fields, but saves an explicitly entered zero', () => {
    const onChange = vi.fn(), onClose = vi.fn();
    render(<KonstaProvider theme="ios" dark>
      <WeightRepsPicker opened target={null} value={{ reps: 0, weightKg: 0 }}
        emptyFields={{ reps: true, weightKg: true }} onChange={onChange} onClose={onClose} />
    </KonstaProvider>);
    expect(document.querySelector('[data-ui-picker-static-value="first"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Изменить повторения' }).querySelector('.ui-icon')).not.toBeNull();
    const input = openInput();
    expect(input.value).toBe('');
    setDigits('0');
    save();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(
      { reps: 0, weightKg: 0 }, { reps: true, weightKg: false },
    );
  });

  it('does not commit missing fields when dismissed without edits', () => {
    const onChange = vi.fn(), onClose = vi.fn();
    render(<KonstaProvider theme="ios" dark>
      <WeightRepsPicker opened target={null} value={{ reps: 0, weightKg: 0 }}
        emptyFields={{ reps: true, weightKg: true }} onChange={onChange} onClose={onClose} />
    </KonstaProvider>);
    dismiss();
    expect(onChange).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('saves an unchanged or retyped number as accepted FACT', () => {
    const picker = renderPicker({ value: { reps: 8, weightKg: 77.5 } });
    openInput();
    setDigits('8');
    save();
    expect(picker.onChange).toHaveBeenCalledExactlyOnceWith({ reps: 8, weightKg: 77.5 });
    expect(picker.onClose).toHaveBeenCalledOnce();
  });

  it('drops editing state when its owner unmounts', () => {
    const picker = renderPicker();
    openInput();
    setDigits('99');
    picker.setValue({ reps: 8, weightKg: 77.5 }, false);
    expect(screen.queryByRole('textbox', { name: /^Ввести / })).toBeNull();
    picker.setValue({ reps: 8, weightKg: 77.5 });
    expect(document.querySelector('[data-ui-picker-static-value="first"] text')?.textContent).toBe('8');
    expect(picker.onChange).not.toHaveBeenCalled();
  });

  it('does not accept negative or fractional incoming domain values', () => {
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
