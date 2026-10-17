import { describe, expect, it } from 'vitest';
import { resolveScheduledStart, validateScheduleTiming } from './workout-scheduling-time';

const valid = {
  calendarDate: '2026-10-19', startMinute: 600, durationMinutes: 60,
  timeZone: 'Europe/Berlin',
};

describe('scheduling wall clock and time zones', () => {
  it('accepts legitimate calendar dates and checks time boundaries', () => {
    expect(validateScheduleTiming(valid)).toEqual(valid);
    for (const calendarDate of ['2026-02-29', '2026-13-01', '2026-04-31', '19/10/2026']) {
      expect(() => validateScheduleTiming({ ...valid, calendarDate })).toThrow('INVALID_SCHEDULE_DATE');
    }
    for (const [startMinute, durationMinutes] of [[-1, 60], [1440, 1], [1380, 90],
      [60.5, 30], [600, 0], [600, Number.NaN]]) {
      expect(() => validateScheduleTiming({ ...valid, startMinute, durationMinutes }))
        .toThrow('INVALID_SCHEDULE_TIME');
    }
    expect(() => validateScheduleTiming({ ...valid, timeZone: 'Fake/Unknown' }))
      .toThrow('INVALID_SCHEDULE_TIME_ZONE');
  });

  it('converts real instants without using the device time zone', () => {
    expect(resolveScheduledStart(valid)).toBe('2026-10-19T08:00:00.000Z');
    expect(resolveScheduledStart({ ...valid, timeZone: 'Asia/Tokyo' }))
      .toBe('2026-10-19T01:00:00.000Z');
  });

  it('rejects missing and ambiguous times at the DST changeover', () => {
    expect(() => resolveScheduledStart({ ...valid, calendarDate: '2026-03-29', startMinute: 150 }))
      .toThrow('NONEXISTENT_SCHEDULE_TIME');
    expect(() => resolveScheduledStart({ ...valid, calendarDate: '2026-10-25', startMinute: 150 }))
      .toThrow('AMBIGUOUS_SCHEDULE_TIME');
    expect(resolveScheduledStart({ ...valid, calendarDate: '2026-10-25', startMinute: 210 }))
      .toBe('2026-10-25T02:30:00.000Z');
  });
});
