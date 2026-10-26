// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExerciseTrackingPickersCatalog } from './ExerciseTrackingPickersCatalog';

function renderCatalog() {
  return render(
    <KonstaProvider theme="ios" dark>
      <div className="k-ios dark">
        <ExerciseTrackingPickersCatalog />
      </div>
    </KonstaProvider>,
  );
}

function openPicker(buttonLabel: string, dialogLabel: string) {
  fireEvent.click(screen.getByRole('button', { name: buttonLabel }));
  return screen.getByRole('dialog', { name: dialogLabel });
}

function select(dialog: HTMLElement, columnLabel: string, optionLabel: string) {
  const column = within(dialog).getByRole('listbox', { name: columnLabel });
  fireEvent.click(within(column).getByRole('option', { name: optionLabel }));
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

describe('UI Kit exercise tracking picker catalog', () => {
  it('shows every picker with updated ranges and readable controlled values', () => {
    renderCatalog();

    expect(screen.getByText('Num picker')).toBeTruthy();
    expect(screen.getByText('Вес + повторения')).toBeTruthy();
    expect(screen.getByText('DurationPicker · продолжительность')).toBeTruthy();
    expect(screen.getByText('DistancePicker · дистанция')).toBeTruthy();
    expect(screen.getByText('WeightPicker · вес')).toBeTruthy();

    expect(screen.getByText('Выбрано: 123')).toBeTruthy();
    expect(screen.getByText('Повторения: 8 · Вес: 77.75 кг')).toBeTruthy();
    expect(screen.getByText('Выбрано: 00:02:05 (125 с)')).toBeTruthy();
    expect(screen.getByText('Выбрано: 2 км 050 м (2050 м)')).toBeTruthy();
    expect(screen.getByText('Выбрано: 70.75 кг')).toBeTruthy();
    expect(screen.getByText(/Целые числа от 0 до 999/)).toBeTruthy();
    expect(screen.getAllByText(/дроби 00 \/ 25 \/ 5 \/ 75/)).toHaveLength(2);
  });

  it('allows choosing exact elapsed seconds, then closes without resetting the value', () => {
    renderCatalog();
    const dialog = openPicker('Выбрать продолжительность', 'Выбор продолжительности');
    select(dialog, 'Секунды продолжительности', '06');
    expect(screen.getByText('Выбрано: 00:02:06 (126 с)')).toBeTruthy();

    const backdrop = dialog.previousElementSibling;
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as Element);
    expect(screen.getByText('Выбрано: 00:02:06 (126 с)')).toBeTruthy();

    const reopened = openPicker('Выбрать продолжительность', 'Выбор продолжительности');
    expect(within(within(reopened).getByRole('listbox', { name: 'Секунды продолжительности' }))
      .getByRole('option', { name: '06' }).getAttribute('aria-selected')).toBe('true');
  });

  it('updates distance by one meter without changing kilometers', () => {
    renderCatalog();
    const dialog = openPicker('Выбрать дистанцию', 'Выбор дистанции');
    select(dialog, 'Метры', '051 м');
    expect(screen.getByText('Выбрано: 2 км 051 м (2051 м)')).toBeTruthy();
  });

  it('supports selecting the new 0.75 kilogram fraction in the standalone weight picker', () => {
    renderCatalog();
    const dialog = openPicker('Выбрать вес', 'Выбор веса');
    select(dialog, 'Доли килограмма', '0,25');
    expect(screen.getByText('Выбрано: 70.25 кг')).toBeTruthy();
    select(dialog, 'Доли килограмма', '0,75');
    expect(screen.getByText('Выбрано: 70.75 кг')).toBeTruthy();
  });

  it('keeps the revised NumPicker and WeightRepsPicker demonstrations interactive', () => {
    renderCatalog();
    const num = openPicker('Выбрать число', 'Выбор числа');
    select(num, 'Сотни', '9');
    expect(screen.getByText('Выбрано: 923')).toBeTruthy();

    const backdrop = num.previousElementSibling;
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as Element);
    const weightReps = openPicker('Выбрать повторения и вес', 'Повторения и вес');
    select(weightReps, 'Доли килограмма', '0,25');
    expect(screen.getByText('Повторения: 8 · Вес: 77.25 кг')).toBeTruthy();
  });
});
