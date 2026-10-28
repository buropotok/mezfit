// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DayScheduleEventCard } from './DayScheduleEventCard';
import { Badge } from './Badge';

afterEach(cleanup);
it('keeps athlete/status and time/day in separate rows with fixed status and time', () => {
  render(<DayScheduleEventCard title="Очень длинное имя атлета" detail="Длинное название дня"
    status={<Badge color="yellow">Черновик</Badge>} media={<img src="/athlete.jpg" alt="Атлет" />}
    state={{ startMinutes: 570, durationMinutes: 60, height: 62, compact: false, lifted: false, editing: false }} />);
  const status = screen.getByText('Черновик');
  const name = screen.getByText('Очень длинное имя атлета');
  expect(status.parentElement?.className).toContain('__fixed');
  expect(name.className).toContain('__truncate');
  expect(name.parentElement).toBe(status.parentElement?.parentElement);
  const time = screen.getByText('09:30–10:30');
  expect(time.className).toContain('__fixed');
  expect(time.nextElementSibling?.textContent).toBe('Длинное название дня');
  expect(screen.getByAltText('Атлет').getAttribute('src')).toBe('/athlete.jpg');
});

it('uses one touch surface for avatar and text, prevents native callouts and keeps clicks', () => {
  const clicked = vi.fn();
  const view = render(<DayScheduleEventCard title="Анна" detail="Ноги"
    media={<img src="/anna.jpg" alt="Аватар Анны" />} corner={<span>Формат</span>} cornerSize={31}
    onClick={clicked}
    state={{ startMinutes: 600, durationMinutes: 60, height: 62, compact: false, lifted: false, editing: false }} />);
  const surface = screen.getByRole('button', { name: /Анна.*10:00–11:00.*Ноги/ });
  expect(surface.hasAttribute('data-ui-dnd-handle')).toBe(true);
  expect(fireEvent.contextMenu(surface)).toBe(false);
  expect(fireEvent.dragStart(surface)).toBe(false);
  fireEvent.click(surface);
  expect(clicked).toHaveBeenCalledOnce();
  expect(view.container.querySelector<HTMLElement>('.ui-day-schedule-event-card__corner')?.style.height).toBe('31px');
});

it('uses one compact row in day/name/time/status/icon order and hides the avatar without resizing it', () => {
  const props = { title: 'Анна', detail: 'День 1', timeLabel: '10:00–10:01',
    status: <Badge>Завершена</Badge>, compactStatus: 'Завершена',
    media: <img src="/anna.jpg" alt="Аватар Анны" />, corner: <span>Формат</span>, cornerSize: 32 };
  const view = render(<DayScheduleEventCard {...props} state={{ startMinutes: 600, durationMinutes: 1,
    height: 16, compact: true, lifted: false, editing: false }} />);
  expect(screen.queryByAltText('Аватар Анны')).toBeNull();
  const row = view.container.querySelector('.ui-day-schedule-event-card__compact-row');
  expect([...row!.children].map(child => child.textContent)).toEqual(['День 1', 'Анна', '10:00–10:01', 'Завершена', 'Формат']);
  const icon = view.container.querySelector<HTMLElement>('.ui-day-schedule-event-card__corner');
  expect(icon?.style.height).toBe('16px');
  expect(screen.getByRole('button', { name: /День 1.*Анна.*10:00–10:01.*Завершена.*Формат/ })).toBeTruthy();
  view.rerender(<DayScheduleEventCard {...props} state={{ startMinutes: 600, durationMinutes: 60,
    height: 62, compact: false, lifted: false, editing: false }} />);
  expect(screen.getByAltText('Аватар Анны').closest('.ui-day-schedule-event-card__media')).toBeTruthy();
  expect(screen.getByText('Формат').closest('.ui-day-schedule-event-card__corner')).toBeTruthy();
});

it('selects purple event styling without changing the workout default in all visual states', () => {
  const base = { startMinutes: 600, durationMinutes: 60, height: 62, compact: false };
  for (const state of [
    { ...base, lifted: false, editing: false },
    { ...base, lifted: true, editing: false },
    { ...base, lifted: false, editing: true },
  ]) {
    const { container, unmount } = render(<DayScheduleEventCard title="Личные дела" variant="event" state={state} />);
    const card = container.querySelector('.ui-day-schedule-event-card');
    expect(card?.classList.contains('ui-day-schedule-event-card--event')).toBe(true);
    expect(card?.classList.contains('ui-day-schedule-event-card--lifted')).toBe(state.lifted);
    expect(card?.classList.contains('ui-day-schedule-event-card--editing')).toBe(state.editing);
    unmount();
  }
  const workout = render(<DayScheduleEventCard title="Тренировка" state={{
    ...base, lifted: false, editing: false,
  }} />);
  expect(workout.container.querySelector('.ui-day-schedule-event-card--event')).toBeNull();
});
