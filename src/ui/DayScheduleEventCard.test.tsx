// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
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
