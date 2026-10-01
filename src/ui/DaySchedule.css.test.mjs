import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dayScheduleCss = readFileSync(
  new URL('./day-schedule.css', import.meta.url),
  'utf8',
);

describe('DaySchedule CSS contract', () => {
  it('adds a light halo to the lifted DnD tile and fades it during drop', () => {
    expect(dayScheduleCss).toContain('0 0 18px rgb(255 255 255 / 0.16)');
    expect(dayScheduleCss).toContain('0 0 36px rgb(170 205 255 / 0.10)');
    expect(dayScheduleCss).toContain('.ui-day-schedule__drag-overlay-wrapper--dropping .ui-day-schedule__drag-visual');
    expect(dayScheduleCss).toContain('box-shadow 90ms ease-in');
  });
});
