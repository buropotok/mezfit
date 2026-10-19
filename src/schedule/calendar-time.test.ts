import { afterEach, describe, expect, it, vi } from 'vitest';
import { calendarSegments, localScheduleEnd, localScheduleInstant } from './calendar-time';
afterEach(() => vi.unstubAllEnvs());

describe('local schedule calendar', () => {
  it('retains both parts of a workout and no empty segment at midnight', () => {
    vi.stubEnv('TZ', 'UTC');
    expect(calendarSegments('2026-10-19T23:30:00.000Z', 120)).toEqual([
      { date: '2026-10-19', startMinutes: 1410, durationMinutes: 30 },
      { date: '2026-10-20', startMinutes: 0, durationMinutes: 90 },
    ]);
    expect(calendarSegments('2026-10-19T23:30:00.000Z', 30)).toHaveLength(1);
  });

  it('rejects both nonexistent and ambiguous wall times', () => {
    vi.stubEnv('TZ', 'Europe/Berlin');
    expect(() => localScheduleInstant('2026-03-29', '02:30')).toThrow(/недоступно/);
    expect(() => localScheduleInstant('2026-10-25', '02:30')).toThrow(/повторяется/);
    expect(localScheduleInstant('2026-10-25', '03:30')).toBe('2026-10-25T02:30:00.000Z');
  });

  it('uses next calendar day and its offset for overnight endings', () => {
    vi.stubEnv('TZ', 'Europe/Berlin');
    expect(localScheduleEnd(new Date('2026-03-28T22:30:00.000Z'), '03:30'))
      .toBe('2026-03-29T01:30:00.000Z');
    expect(() => localScheduleEnd(new Date('2026-10-24T21:30:00.000Z'), '02:30'))
      .toThrow(/повторяется/);
  });

  it('splits fallback at the offset change without displaying a false ending', () => {
    vi.stubEnv('TZ', 'Europe/Berlin');
    expect(calendarSegments('2026-10-24T23:30:00.000Z', 180)).toEqual([
      { date: '2026-10-25', startMinutes: 90, durationMinutes: 90 },
      { date: '2026-10-25', startMinutes: 120, durationMinutes: 90 },
    ]);
  });

  it('leaves the spring wall-clock gap empty', () => {
    vi.stubEnv('TZ', 'Europe/Berlin');
    expect(calendarSegments('2026-03-29T00:30:00.000Z', 180)).toEqual([
      { date: '2026-03-29', startMinutes: 90, durationMinutes: 30 },
      { date: '2026-03-29', startMinutes: 180, durationMinutes: 150 },
    ]);
  });
});
