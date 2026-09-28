/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DaySchedule, type DayScheduleEvent } from './DaySchedule';
import type { LocalDate } from './date-picker/DatePicker';

const changed = vi.fn();
const events: Readonly<Record<LocalDate, readonly DayScheduleEvent[]>> = {
  '2026-09-28': [{ id: 'a', startMinutes: 600, durationMinutes: 60 }],
  '2026-09-29': [{ id: 'b', startMinutes: 720, durationMinutes: 30 }],
};

beforeEach(() => {
  changed.mockClear();
  vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'touch';
    }
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function(this: HTMLElement) {
    if (this.classList.contains('tab-link')) return 50;
    return 350;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(44);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    const index = Number(this.dataset.index ?? 0);
    const width = this.classList.contains('tab-link') ? 50 : 350;
    const left = this.classList.contains('tab-link') ? index * 50 : 0;
    return { x: left, y: 0, left, top: 0, right: left + width, bottom: 44, width, height: 44, toJSON: () => ({}) };
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: vi.fn(() => ({ cancel: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderSchedule(date: LocalDate = '2026-09-28') {
  return render(
    <DaySchedule
      date={date}
      today="2026-09-28"
      eventsByDate={events}
      onDateChange={changed}
      renderEvent={event => <div data-testid={`event-${event.id}`}>{event.id}</div>}
    />,
  );
}

describe('DaySchedule', () => {
  it('renders the selected day and adjacent day event content', () => {
    const view = renderSchedule();
    expect(view.getAllByTestId('event-a')).toHaveLength(1);
    expect(view.getAllByTestId('event-b')).toHaveLength(1);
  });

  it('renders seven full-width week slots inside the private liquid-glass scene', () => {
    const view = renderSchedule();
    const hosts = view.container.querySelectorAll('.ui-day-schedule__week-scene');
    const current = hosts[1]?.shadowRoot;
    expect(current).toBeTruthy();
    expect(current?.querySelectorAll('.tab-link')).toHaveLength(7);
  });

  it('requests a date change when another day is tapped', () => {
    const view = renderSchedule();
    const host = view.container.querySelectorAll('.ui-day-schedule__week-scene')[1];
    const button = host?.shadowRoot?.querySelectorAll<HTMLButtonElement>('.tab-link')[1];
    if (!button) throw new Error('Missing Tuesday slot');
    fireEvent.click(button);
    expect(changed).toHaveBeenCalledWith('2026-09-29');
  });

  it('keeps external controlled date changes authoritative', () => {
    const view = renderSchedule();
    view.rerender(
      <DaySchedule
        date="2026-09-29"
        today="2026-09-28"
        eventsByDate={events}
        onDateChange={changed}
        renderEvent={event => <div data-testid={`event-${event.id}`}>{event.id}</div>}
      />,
    );
    const host = view.container.querySelectorAll('.ui-day-schedule__week-scene')[1];
    const selected = host?.shadowRoot?.querySelectorAll<HTMLButtonElement>('.tab-link')[1];
    expect(selected?.getAttribute('aria-selected')).toBe('true');
  });

  it('requests the next day after a committed horizontal day swipe', () => {
    const view = renderSchedule();
    const viewport = view.container.querySelector<HTMLElement>('.ui-day-schedule__day-viewport');
    if (!viewport) throw new Error('Missing day viewport');
    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 390 });
    fireEvent.pointerDown(viewport, { pointerId: 1, pointerType: 'touch', clientX: 320, clientY: 300 });
    fireEvent.pointerMove(viewport, { pointerId: 1, pointerType: 'touch', clientX: 120, clientY: 300 });
    fireEvent.pointerUp(viewport, { pointerId: 1, pointerType: 'touch', clientX: 120, clientY: 300 });
    act(() => vi.advanceTimersByTime(320));
    expect(changed).toHaveBeenCalledWith('2026-09-29');
  });
});
