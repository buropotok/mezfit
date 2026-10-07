/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatePicker, type LocalDate } from './DatePicker';

function localToday(): LocalDate {
  const now = new Date();
  return `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DatePicker top-panel surface', () => {
  it('keeps twelve months horizontal, centers the value month, and stays open after date selection', () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    const view = render(
      <KonstaProvider theme="ios" dark>
        <div className="k-ios dark">
          <DatePicker
            opened
            surface="top-panel"
            value="2026-10-07"
            onChange={onChange}
            onClose={onClose}
          />
        </div>
      </KonstaProvider>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Выбор даты' });
    expect(dialog.getAttribute('data-date-picker-surface')).toBe('top-panel');
    expect(dialog.getAttribute('aria-modal')).not.toBe('true');
    expect(screen.queryByText('Среда, 7 Октября')).toBeNull();
    expect(screen.getByText('Октябрь', { selector: '.ui-date-picker__top-month' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Закрыть календарь' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Выбрать год, сейчас 2026' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Сегодня' })).toBeTruthy();

    const months = view.container.querySelectorAll('.ui-date-picker__month--horizontal');
    expect(months).toHaveLength(12);

    const scroll = view.container.querySelector<HTMLElement>('.ui-date-picker__scroll--horizontal');
    expect(scroll?.scrollLeft).toBe(9 * 390);
    if (!scroll) throw new Error('Missing horizontal month scroller');
    scroll.scrollLeft = 11 * 390;
    fireEvent.scroll(scroll);
    expect(screen.getByText('Декабрь', { selector: '.ui-date-picker__top-month' })).toBeTruthy();

    const selectedDay = dialog.querySelector<HTMLButtonElement>('button[aria-current="date"]');
    expect(selectedDay).not.toBeNull();
    if (!selectedDay) throw new Error('Missing selected date button');
    fireEvent.click(selectedDay);
    expect(onChange).toHaveBeenCalledWith('2026-10-07');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('jumps to today without closing and has no explicit close action', () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    render(
      <KonstaProvider theme="ios" dark>
        <div className="k-ios dark">
          <DatePicker
            opened
            surface="top-panel"
            value="2020-03-12"
            onChange={onChange}
            onClose={onClose}
          />
        </div>
      </KonstaProvider>,
    );

    const today = localToday();
    const todayDate = new Date();
    fireEvent.click(screen.getByRole('button', { name: 'Сегодня' }));
    expect(onChange).toHaveBeenLastCalledWith(today);
    expect(screen.getByRole('button', { name: `Выбрать год, сейчас ${todayDate.getFullYear()}` })).toBeTruthy();
    const scroll = document.querySelector<HTMLElement>('.ui-date-picker__scroll--horizontal');
    expect(scroll?.scrollLeft).toBe(todayDate.getMonth() * 390);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Закрыть календарь' })).toBeNull();
  });
});
