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
