import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dayScheduleCss = readFileSync(
  new URL('./day-schedule.css', import.meta.url),
  'utf8',
);

describe('DaySchedule CSS contract', () => {
  it('reserves background clearance above the midnight grid for fixed header controls', () => {
    expect(dayScheduleCss).toContain('--ui-day-schedule-top-clearance: calc(132px + max(16px, var(--k-safe-area-top)))');
    expect(dayScheduleCss).toContain('.ui-day-schedule__top-clearance');
    expect(dayScheduleCss).toContain('height: var(--ui-day-schedule-top-clearance)');
  });

  it('adds a light halo to the lifted DnD tile and fades it during drop', () => {
    expect(dayScheduleCss).toContain('0 0 18px rgb(255 255 255 / 0.16)');
    expect(dayScheduleCss).toContain('0 0 36px rgb(170 205 255 / 0.10)');
    expect(dayScheduleCss).toContain('.ui-day-schedule__drag-overlay-wrapper--dropping .ui-day-schedule__drag-visual');
    expect(dayScheduleCss).toContain('box-shadow 90ms ease-in');
  });
});
