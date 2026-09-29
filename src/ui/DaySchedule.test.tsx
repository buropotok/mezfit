/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DaySchedule, getDayScheduleValue, type DayScheduleEvent } from './DaySchedule';
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
  it('keeps adjacent week previews neutral and outside the accessible controls', () => {
    const view = renderSchedule('2026-10-04');
    const hosts = view.container.querySelectorAll('.ui-day-schedule__week-scene');
    for (const host of [hosts[0], hosts[2]]) {
      expect(host.getAttribute('aria-hidden')).toBe('true');
      const shadow = host.shadowRoot!;
      expect(shadow.querySelectorAll('.tab-link')).toHaveLength(7);
      expect(shadow.querySelectorAll('button, [role="tab"], [role="tablist"], [tabindex]')).toHaveLength(0);
      expect(shadow.querySelectorAll('.active, [aria-selected]')).toHaveLength(0);
      fireEvent.click(shadow.querySelector('.tab-link')!);
    }
    expect(changed).not.toHaveBeenCalled();
    expect(hosts[1].hasAttribute('aria-hidden')).toBe(false);
    expect(hosts[1].shadowRoot!.querySelectorAll('button[role="tab"]')).toHaveLength(7);
    expect(hosts[1].shadowRoot!.querySelector('[aria-selected="true"]')?.getAttribute('data-index')).toBe('6');
  });

  it('renders the selected day and adjacent day event content without enabling drag by default', () => {
    const view = renderSchedule();
    expect(view.getAllByTestId('event-a')).toHaveLength(1);
    expect(view.getAllByTestId('event-b')).toHaveLength(1);
    const frame = view.container.querySelector<HTMLElement>('[data-event-id="a"]');
    expect(frame?.hasAttribute('data-schedule-no-swipe')).toBe(false);
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

  it('lets a quick horizontal swipe from an event card win before long-press drag activates', () => {
    const moved = vi.fn();
    const view = render(
      <DaySchedule
        date="2026-09-28"
        today="2026-09-28"
        eventsByDate={events}
        onDateChange={changed}
        onEventMove={moved}
        renderEvent={event => <div>{event.id}</div>}
      />,
    );
    const frame = view.container.querySelector<HTMLElement>('[data-event-id="a"]');
    const viewport = view.container.querySelector<HTMLElement>('.ui-day-schedule__day-viewport');
    if (!frame || !viewport) throw new Error('Missing draggable event frame or day viewport');
    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 390 });

    fireEvent.pointerDown(frame, { pointerId: 7, pointerType: 'touch', clientX: 320, clientY: 300 });
    fireEvent.pointerMove(viewport, { pointerId: 7, pointerType: 'touch', clientX: 120, clientY: 300 });
    fireEvent.pointerUp(viewport, { pointerId: 7, pointerType: 'touch', clientX: 120, clientY: 300 });
    act(() => vi.advanceTimersByTime(320));

    expect(changed).toHaveBeenCalledWith('2026-09-29');
    expect(moved).not.toHaveBeenCalled();
  });

  it('activates event drag on pointer movement and locks timeline scrolling until drop', () => {
    const moved = vi.fn();
    const view = render(
      <DaySchedule
        date="2026-09-28"
        today="2026-09-28"
        eventsByDate={events}
        onDateChange={changed}
        onEventMove={moved}
        renderEvent={event => <div>{event.id}</div>}
      />,
    );
    const frame = view.container.querySelector<HTMLElement>('[data-event-id="a"]');
    const schedule = view.container.querySelector<HTMLElement>('.ui-day-schedule');
    if (!frame || !schedule) throw new Error('Missing draggable event frame');

    fireEvent.pointerDown(frame, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(document, { pointerId: 1, pointerType: 'mouse', buttons: 1, clientX: 100, clientY: 120 });

    expect(schedule.classList.contains('ui-day-schedule--event-dragging')).toBe(true);

    fireEvent.pointerUp(document, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 120 });
    expect(schedule.classList.contains('ui-day-schedule--event-dragging')).toBe(false);
    act(() => vi.advanceTimersByTime(50));
  });

  it('activates event drag from a touch pointer after the long-press delay', () => {
    const moved = vi.fn();
    const view = render(
      <DaySchedule
        date="2026-09-28"
        today="2026-09-28"
        eventsByDate={events}
        onDateChange={changed}
        onEventMove={moved}
        renderEvent={event => <div>{event.id}</div>}
      />,
    );
    const frame = view.container.querySelector<HTMLElement>('[data-event-id="a"]');
    const schedule = view.container.querySelector<HTMLElement>('.ui-day-schedule');
    if (!frame || !schedule) throw new Error('Missing draggable touch event frame');

    fireEvent.pointerDown(frame, {
      pointerId: 7,
      pointerType: 'touch',
      button: 0,
      clientX: 100,
      clientY: 100,
    });

    act(() => vi.advanceTimersByTime(299));
    expect(schedule.classList.contains('ui-day-schedule--event-dragging')).toBe(false);

    act(() => vi.advanceTimersByTime(1));
    expect(schedule.classList.contains('ui-day-schedule--event-dragging')).toBe(true);

    fireEvent.pointerMove(document, {
      pointerId: 7,
      pointerType: 'touch',
      buttons: 1,
      clientX: 100,
      clientY: 120,
    });
    fireEvent.pointerUp(document, {
      pointerId: 7,
      pointerType: 'touch',
      button: 0,
      clientX: 100,
      clientY: 120,
    });
    expect(schedule.classList.contains('ui-day-schedule--event-dragging')).toBe(false);
    act(() => vi.advanceTimersByTime(50));
  });

  it('keeps long-press drag eligible through small finger jitter', () => {
    const moved = vi.fn();
    const view = render(
      <DaySchedule
        date="2026-09-28"
        today="2026-09-28"
        eventsByDate={events}
        onDateChange={changed}
        onEventMove={moved}
        renderEvent={event => <div>{event.id}</div>}
      />,
    );
    const frame = view.container.querySelector<HTMLElement>('[data-event-id="a"]');
    const schedule = view.container.querySelector<HTMLElement>('.ui-day-schedule');
    if (!frame || !schedule) throw new Error('Missing draggable touch event frame');

    fireEvent.pointerDown(frame, {
      pointerId: 9,
      pointerType: 'touch',
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(document, {
      pointerId: 9,
      pointerType: 'touch',
      clientX: 118,
      clientY: 106,
    });

    act(() => vi.advanceTimersByTime(300));
    expect(schedule.classList.contains('ui-day-schedule--event-dragging')).toBe(true);

    fireEvent.pointerUp(document, {
      pointerId: 9,
      pointerType: 'touch',
      clientX: 118,
      clientY: 106,
    });
    act(() => vi.advanceTimersByTime(50));
  });

  it('renders only the event-sized GlassSurface while an event is lifted', () => {
    const moved = vi.fn();
    const view = render(
      <DaySchedule
        date="2026-09-28"
        today="2026-09-28"
        eventsByDate={events}
        onDateChange={changed}
        onEventMove={moved}
        renderEvent={event => <div className="event-card-content">{event.id}</div>}
      />,
    );
    const frame = view.container.querySelector<HTMLElement>('[data-event-id="a"]');
    if (!frame) throw new Error('Missing draggable event frame');

    fireEvent.pointerDown(frame, {
      pointerId: 10,
      pointerType: 'touch',
      clientX: 100,
      clientY: 100,
    });
    act(() => vi.advanceTimersByTime(300));

    const overlay = view.container.querySelector<HTMLElement>('.ui-day-schedule__drag-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay?.parentElement?.style.height).toBe('100px');
    expect(overlay?.querySelector('.ui-day-schedule__drag-overlay-content')?.textContent).toBe('');

    fireEvent.pointerUp(document, {
      pointerId: 10,
      pointerType: 'touch',
      clientX: 100,
      clientY: 100,
    });
    act(() => vi.advanceTimersByTime(50));
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


function viewportFor(view: ReturnType<typeof renderSchedule>, kind: 'day' | 'week') {
  const element = view.container.querySelector<HTMLElement>(`.ui-day-schedule__${kind}-viewport`);
  if (!element) throw new Error('Missing viewport');
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: 350 });
  return element;
}

function swipe(element: HTMLElement, dx = -180) {
  fireEvent.pointerDown(element, { pointerId: 1, pointerType: 'touch', clientX: 220, clientY: 200 });
  fireEvent.pointerMove(element, { pointerId: 1, pointerType: 'touch', clientX: 220 + dx, clientY: 200 });
  fireEvent.pointerUp(element, { pointerId: 1, pointerType: 'touch', clientX: 220 + dx, clientY: 200 });
}

function withDate(date: LocalDate, onDateChange: (date: LocalDate) => void = changed) {
  return <DaySchedule date={date} today="2026-09-28" eventsByDate={events} onDateChange={onDateChange} renderEvent={event => <div>{event.id}</div>} />;
}

describe('DaySchedule transition ownership', () => {
  it.each([-180, 180])('recenters both tracks without a transition after a weekday tap then week swipe (%s)', dx => {
    const view = renderSchedule();
    const accept = (next: LocalDate) => view.rerender(withDate(next, accept));
    view.rerender(withDate('2026-09-28', accept));
    const friday = view.container.querySelectorAll('.ui-day-schedule__week-scene')[1].shadowRoot!.querySelectorAll('button')[4];
    fireEvent.click(friday);
    act(() => vi.advanceTimersByTime(400));
    const day = viewportFor(view, 'day');
    day.scrollTop = 375;
    swipe(viewportFor(view, 'week'), dx);
    const transitionsAtReset: string[] = [];
    for (const kind of ['week', 'day']) {
      const track = view.container.querySelector<HTMLElement>(`.ui-day-schedule__${kind}-track`)!;
      const setter = vi.spyOn(track.style, 'transform', 'set');
      setter.mockImplementation(function(value: string) {
        transitionsAtReset.push(track.style.transition);
        track.style.setProperty('transform', value);
      });
    }
    act(() => vi.advanceTimersByTime(300));
    expect(transitionsAtReset.length).toBeGreaterThan(0);
    expect(transitionsAtReset.every(transition => transition === 'none')).toBe(true);
    expect(view.container.querySelectorAll('.ui-day-schedule__day-panel')[1].getAttribute('data-date')).toBe(dx < 0 ? '2026-10-09' : '2026-09-25');
    expect(day.scrollTop).toBe(375);
    act(() => vi.advanceTimersByTime(50));
    swipe(viewportFor(view, 'week'), dx);
    expect(view.container.querySelector<HTMLElement>('.ui-day-schedule__week-track')!.style.transition).toContain('300ms');
  });

  it('animates from the outgoing day to a tapped nonadjacent day after acceptance', () => {
    const view = renderSchedule();
    const friday = view.container.querySelectorAll('.ui-day-schedule__week-scene')[1].shadowRoot!.querySelectorAll('button')[4];
    fireEvent.click(friday);
    expect(changed).toHaveBeenCalledWith('2026-10-02');
    view.rerender(withDate('2026-10-02'));
    const panels = () => [...view.container.querySelectorAll('.ui-day-schedule__day-panel')].map(panel => panel.getAttribute('data-date'));
    expect(panels()).toEqual(['2026-09-27', '2026-09-28', '2026-10-02']);
    act(() => vi.advanceTimersByTime(50));
    expect(view.container.querySelector('.ui-day-schedule__day-track--animating')).not.toBeNull();
    act(() => vi.advanceTimersByTime(300));
    expect(panels()).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('does not cancel a day swipe when implicit capture leaves a child', () => {
    const view = renderSchedule();
    const day = viewportFor(view, 'day');
    const child = day.querySelector('.ui-day-schedule__day-panel')!;
    fireEvent.pointerDown(child, { pointerId: 1, clientX: 220, clientY: 200 });
    fireEvent.pointerMove(child, { pointerId: 1, clientX: 100, clientY: 200 });
    fireEvent.lostPointerCapture(child, { pointerId: 1 });
    fireEvent.pointerUp(day, { pointerId: 1, clientX: 100, clientY: 200 });
    act(() => vi.advanceTimersByTime(310));
    expect(changed.mock.calls).toEqual([['2026-09-29']]);
  });

  it('cancels a real loss of capture on the owning viewport', () => {
    const view = renderSchedule();
    const day = viewportFor(view, 'day');
    fireEvent.pointerDown(day, { pointerId: 1, clientX: 220, clientY: 200 });
    fireEvent.pointerMove(day, { pointerId: 1, clientX: 100, clientY: 200 });
    fireEvent.lostPointerCapture(day, { pointerId: 1 });
    act(() => vi.advanceTimersByTime(350));
    expect(changed).not.toHaveBeenCalled();
  });

  it('exports navbar data without rendering navbar or action controls', () => {
    const view = renderSchedule();
    expect(view.queryByText('Сегодня')).toBeNull();
    expect(view.queryByLabelText('Назад')).toBeNull();
    expect(view.queryByLabelText('Открыть календарь')).toBeNull();
    expect(getDayScheduleValue('2026-09-28', '2026-09-28')).toEqual({ date: '2026-09-28', title: 'Сегодня', weekdayIndex: 0, isToday: true });
    expect(getDayScheduleValue('2026-10-02', '2026-09-28').title).toBe('Пт, 2 октября');
  });

  it('cancels an in-flight request when the caller changes the date', () => {
    const view = renderSchedule();
    swipe(viewportFor(view, 'day'));
    act(() => vi.advanceTimersByTime(100));
    view.rerender(withDate('2026-10-02'));
    act(() => vi.advanceTimersByTime(1000));
    expect(changed).not.toHaveBeenCalled();
    const host = view.container.querySelectorAll('.ui-day-schedule__week-scene')[1];
    expect(host?.shadowRoot?.querySelector('[aria-selected="true"]')?.textContent).toContain('2');
  });

  it('serializes day/week gestures until the current transition finishes', () => {
    const view = renderSchedule();
    swipe(viewportFor(view, 'day'));
    swipe(viewportFor(view, 'day'));
    swipe(viewportFor(view, 'week'));
    act(() => vi.advanceTimersByTime(310));
    expect(changed.mock.calls).toEqual([['2026-09-29']]);
  });

  it('does not turn a cancelled week touch into a date selection', () => {
    const view = renderSchedule();
    const week = viewportFor(view, 'week');
    fireEvent.pointerDown(week, { pointerId: 1, clientX: 70, clientY: 10 });
    fireEvent.pointerCancel(week, { pointerId: 1, clientX: 70, clientY: 10 });
    act(() => vi.advanceTimersByTime(1000));
    expect(changed).not.toHaveBeenCalled();
  });

  it('keeps a vertical scroll from selecting another day', () => {
    const view = renderSchedule();
    const day = viewportFor(view, 'day');
    fireEvent.pointerDown(day, { pointerId: 1, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(day, { pointerId: 1, clientX: 205, clientY: 400 });
    fireEvent.pointerCancel(day, { pointerId: 1, clientX: 205, clientY: 400 });
    act(() => vi.advanceTimersByTime(1000));
    expect(changed).not.toHaveBeenCalled();
  });

  it('dispatches a touch tap exactly once and suppresses the subsequent native click', () => {
    const view = renderSchedule();
    const week = viewportFor(view, 'week');
    const button = view.container.querySelectorAll('.ui-day-schedule__week-scene')[1]?.shadowRoot?.querySelectorAll('.tab-link')[1];
    if (!button) throw new Error('Missing Tuesday');
    fireEvent.pointerDown(button, { pointerId: 1, pointerType: 'touch', clientX: 75, clientY: 10 });
    fireEvent.pointerUp(week, { pointerId: 1, pointerType: 'touch', clientX: 75, clientY: 10 });
    fireEvent.click(button, { detail: 1 });
    expect(changed.mock.calls).toEqual([['2026-09-29']]);
  });

  it('does not activate a second gesture owner after a long press then week swipe', () => {
    const view = renderSchedule();
    const week = viewportFor(view, 'week');
    const button = view.container.querySelectorAll('.ui-day-schedule__week-scene')[1]?.shadowRoot?.querySelector('.tab-link');
    if (!button) throw new Error('Missing Monday');
    fireEvent.pointerDown(button, { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 10 });
    act(() => vi.advanceTimersByTime(180));
    fireEvent.pointerMove(week, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 });
    fireEvent.pointerUp(week, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 });
    act(() => vi.advanceTimersByTime(310));
    expect(changed.mock.calls).toEqual([['2026-10-05']]);
  });

  it('pages Sunday to Monday and waits 50ms before revealing the new selector', () => {
    const view = renderSchedule('2026-10-04');
    swipe(viewportFor(view, 'day'));
    act(() => vi.advanceTimersByTime(300));
    expect(changed.mock.calls).toEqual([['2026-10-05']]);
    view.rerender(withDate('2026-10-05'));
    const current = view.container.querySelectorAll('.ui-day-schedule__week-scene')[1];
    expect(current?.getAttribute('data-suppress-selector')).toBe('true');
    act(() => vi.advanceTimersByTime(49));
    expect(current?.getAttribute('data-suppress-selector')).toBe('true');
    act(() => vi.advanceTimersByTime(1));
    expect(current?.hasAttribute('data-suppress-selector')).toBe(false);
    expect(current?.shadowRoot?.querySelector('.lens')?.classList.contains('tap-spring-active')).toBe(true);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('restores the controlled selection if the caller declines a swipe', () => {
    const view = renderSchedule();
    swipe(viewportFor(view, 'day'));
    act(() => vi.advanceTimersByTime(350));
    const current = view.container.querySelectorAll('.ui-day-schedule__week-scene')[1];
    expect(current?.shadowRoot?.querySelectorAll('.tab-link')[0].getAttribute('aria-selected')).toBe('true');
    swipe(viewportFor(view, 'day'));
    act(() => vi.advanceTimersByTime(350));
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('does not emit delayed changes after unmount', () => {
    const view = renderSchedule();
    swipe(viewportFor(view, 'week'));
    view.unmount();
    act(() => vi.advanceTimersByTime(1000));
    expect(changed).not.toHaveBeenCalled();
  });
});

it('moves the day track without rerendering event cards on each pointer move', () => {
  const renderer = vi.fn((event: DayScheduleEvent) => <span>{event.id}</span>);
  const view = render(<DaySchedule date="2026-09-28" eventsByDate={events} onDateChange={changed} renderEvent={renderer} />);
  renderer.mockClear();
  const day = viewportFor(view, 'day');
  fireEvent.pointerDown(day, { pointerId: 1, clientX: 220, clientY: 200 });
  fireEvent.pointerMove(day, { pointerId: 1, clientX: 180, clientY: 200 });
  fireEvent.pointerMove(day, { pointerId: 1, clientX: 120, clientY: 200 });
  expect(renderer).not.toHaveBeenCalled();
});
