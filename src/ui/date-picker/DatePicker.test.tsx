// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatePicker, type LocalDate } from './DatePicker';

function renderPicker({
  value = '2026-09-25',
  onChange = vi.fn(),
  onClose = vi.fn(),
}: {
  value?: LocalDate;
  onChange?: (value: LocalDate) => void;
  onClose?: () => void;
} = {}) {
  return {
    onChange,
    onClose,
    ...render(
      <KonstaProvider theme="ios" dark>
        <div className="k-ios dark">
          <DatePicker opened value={value} onChange={onChange} onClose={onClose} />
        </div>
      </KonstaProvider>,
    ),
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DatePicker', () => {
  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
  });

  it('renders the selected year as navigation and all twelve months', () => {
    renderPicker();
    expect(screen.getByRole('button', { name: 'Выбрать год, сейчас 2026' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Январь' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Декабрь' })).toBeTruthy();
  });

  it('changes the visible year without committing a date', () => {
    const onChange = vi.fn();
    renderPicker({ onChange });

    fireEvent.click(screen.getByRole('button', { name: 'Выбрать год, сейчас 2026' }));
    fireEvent.click(screen.getByRole('button', { name: '2027' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Выбрать год, сейчас 2027' })).toBeTruthy();
  });

  it('commits a local date and closes after choosing a day', () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    renderPicker({ onChange, onClose });

    fireEvent.click(screen.getByRole('button', { name: /25 сентября 2026/i }));

    expect(onChange).toHaveBeenCalledWith('2026-09-25');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('disables the panel close action while the year popover is open', () => {
    const onClose = vi.fn();
    renderPicker({ onClose });

    fireEvent.click(screen.getByRole('button', { name: 'Выбрать год, сейчас 2026' }));
    const closeButton = screen.getByRole('button', { name: 'Закрыть календарь' });

    expect((closeButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(closeButton);
    expect(onClose).not.toHaveBeenCalled();
  });
});
