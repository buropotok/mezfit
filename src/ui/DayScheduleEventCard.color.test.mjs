import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const css = readFileSync(new URL('./DayScheduleEventCard.css', import.meta.url), 'utf8');

it('renders personal events in #96489E using the same normal, editing and lifted opacities', () => {
  expect(css).toContain('--ui-day-schedule-event-card-color: 150 72 158;');
  expect(css).toContain('#96489E');
  expect(css).toContain('background: rgb(var(--ui-day-schedule-event-card-color, 132 163 150) / 0.58);');
  expect(css).toContain('.ui-day-schedule-event-card--lifted {\n  background: transparent;');
  expect(css).toContain('background: rgb(var(--ui-day-schedule-event-card-color, 132 163 150) / 1);');
});
