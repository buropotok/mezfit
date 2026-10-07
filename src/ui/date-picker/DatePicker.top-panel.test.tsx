/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatePicker, type DatePickerDayStatus, type LocalDate } from './DatePicker';

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

  it('renders today and client day statuses without collapsing them into one state', () => {
    const today = localToday();
    const view = render(
      <KonstaProvider theme="ios" dark>
        <div className="k-ios dark">
          <DatePicker
            opened
            surface="top-panel"
            minYear={1900}
            maxYear={2100}
            value={today}
            dayStatuses={[
              { date: today, status: 'completed' },
            ]}
            onChange={vi.fn()}
            onClose={vi.fn()}
          />
        </div>
      </KonstaProvider>,
    );

    const todayButton = view.container.querySelector<HTMLButtonElement>('.ui-date-picker__day--today');
    expect(todayButton).not.toBeNull();
    expect(todayButton?.getAttribute('data-today')).toBe('true');
    expect(todayButton?.getAttribute('data-day-status')).toBe('completed');
    expect(todayButton?.getAttribute('aria-current')).toBe('date');
    expect(todayButton?.classList.contains('ui-date-picker__day--selected')).toBe(true);
    expect(todayButton?.classList.contains('ui-date-picker__day--status-completed')).toBe(true);
    expect(todayButton?.getAttribute('aria-label')).toContain('сегодня');
    expect(todayButton?.getAttribute('aria-label')).toContain('тренировочная сессия завершена');
  });

  it('renders scheduled, completed, and missed status markers from the input API', () => {
    const view = render(
      <KonstaProvider theme="ios" dark>
        <div className="k-ios dark">
          <DatePicker
            opened
            surface="top-panel"
            value="2026-09-28"
            dayStatuses={[
              { date: '2026-09-27', status: 'scheduled' },
              { date: '2026-09-28', status: 'completed' },
              { date: '2026-09-29', status: 'missed' },
            ]}
            onChange={vi.fn()}
            onClose={vi.fn()}
          />
        </div>
      </KonstaProvider>,
    );

    expect(view.container.querySelector('[data-day-status="scheduled"]')?.classList.contains('ui-date-picker__day--status-scheduled')).toBe(true);
    const completed = view.container.querySelector<HTMLButtonElement>('[data-day-status="completed"]');
    expect(completed?.classList.contains('ui-date-picker__day--status-completed')).toBe(true);
    expect(completed?.classList.contains('ui-date-picker__day--selected')).toBe(true);
    expect(completed?.getAttribute('aria-current')).toBe('date');
    expect(view.container.querySelector('[data-day-status="missed"]')?.classList.contains('ui-date-picker__day--status-missed')).toBe(true);
  });

  it('ignores invalid status dates instead of attaching them to calendar cells', () => {
    const view = render(
      <KonstaProvider theme="ios" dark>
        <div className="k-ios dark">
          <DatePicker
            opened
            surface="top-panel"
            value="2026-02-28"
            dayStatuses={[
              { date: '2026-02-30', status: 'missed' },
            ]}
            onChange={vi.fn()}
            onClose={vi.fn()}
          />
        </div>
      </KonstaProvider>,
    );

    expect(view.container.querySelector('[data-day-status]')).toBeNull();
  });

  it('ignores unknown runtime status values', () => {
    const view = render(
      <KonstaProvider theme="ios" dark>
        <div className="k-ios dark">
          <DatePicker
            opened
            surface="top-panel"
            value="2026-02-28"
            dayStatuses={[
              { date: '2026-02-28', status: 'unknown' as DatePickerDayStatus },
            ]}
            onChange={vi.fn()}
            onClose={vi.fn()}
          />
        </div>
      </KonstaProvider>,
    );

    expect(view.container.querySelector('[data-day-status]')).toBeNull();
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
