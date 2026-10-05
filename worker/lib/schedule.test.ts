import { describe, expect, it } from 'vitest';
import { dayDistance, parseCalendarDay } from './schedule';

describe('schedule calendar dates', () => {
  it('derives a sortable YYYYMMDD key and ISO week metadata', () => {
    expect(parseCalendarDay('2026-10-05')).toEqual({
      dateKey: 20261005,
      localDate: '2026-10-05',
      year: 2026,
      month: 10,
      day: 5,
      isoWeekYear: 2026,
      isoWeek: 41,
      weekday: 1,
    });
  });

  it('keeps ISO week year separate from calendar year at year boundaries', () => {
    expect(parseCalendarDay('2027-01-01')).toMatchObject({
      dateKey: 20270101,
      year: 2027,
      isoWeekYear: 2026,
      isoWeek: 53,
      weekday: 5,
    });
  });

  it('rejects impossible dates and computes range distance without local timezone conversion', () => {
    expect(parseCalendarDay('2026-02-29')).toBeNull();
    const from = parseCalendarDay('2026-09-05');
    const to = parseCalendarDay('2026-11-05');
    if (!from || !to) throw new Error('Expected valid dates');
    expect(dayDistance(from, to)).toBe(61);
  });
});
