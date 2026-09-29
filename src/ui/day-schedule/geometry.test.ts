import { describe, expect, it } from 'vitest';
import { eventGeometry, startMinutesAfterDrag, yForMinutes } from './DayPanel';
import { addDays, dayIndex, startOfWeek } from './dateMath';

describe('schedule geometry and date boundaries', () => {
  it('keeps adjacent short events within their actual intervals', () => {
    const a = eventGeometry({ id: 'a', startMinutes: 600, durationMinutes: 15 });
    const b = eventGeometry({ id: 'b', startMinutes: 615, durationMinutes: 15 });
    expect(a).not.toBeNull(); expect(b).not.toBeNull();
    expect(a!.top + a!.height).toBeLessThan(b!.top);
  });
  it('clips events at the display boundaries and ignores invalid geometry', () => {
    expect(eventGeometry({ id: 'a', startMinutes: 300, durationMinutes: 30 })).toBeNull();
    const crossing = eventGeometry({ id: 'a', startMinutes: 1430, durationMinutes: 60 });
    expect(crossing!.top + crossing!.height).toBeLessThanOrEqual(yForMinutes(1440));
    expect(eventGeometry({ id: 'a', startMinutes: NaN, durationMinutes: 30 })).toBeNull();
    expect(eventGeometry({ id: 'a', startMinutes: 600, durationMinutes: -1 })).toBeNull();
  });
  it('maps vertical event drag distance to bounded whole-minute start times', () => {
    expect(startMinutesAfterDrag(600, 60, 56)).toBe(630);
    expect(startMinutesAfterDrag(600, 60, -1000)).toBe(360);
    expect(startMinutesAfterDrag(1380, 60, 1000)).toBe(1380);
  });

  it('pages across month, year and leap-day boundaries without local timezone shifts', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(startOfWeek('2026-10-04')).toBe('2026-09-28');
    expect(dayIndex('2026-10-05')).toBe(0);
  });
});
