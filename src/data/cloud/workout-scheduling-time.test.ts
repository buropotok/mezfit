import { describe, expect, it } from 'vitest';
import { isUtcInstant, validateScheduleTiming } from './workout-scheduling-time';

const valid = { startsAtUtc: '2026-10-19T08:00:00.000Z', durationMinutes: 60 };

describe('UTC-only scheduling contract', () => {
  it('accepts one canonical UTC serialization and valid durations across midnight', () => {
    expect(validateScheduleTiming(valid)).toEqual(valid);
    expect(isUtcInstant(valid.startsAtUtc)).toBe(true);
    expect(validateScheduleTiming({
      startsAtUtc: '2026-10-19T23:30:00.000Z', durationMinutes: 90,
    })).toMatchObject({ durationMinutes: 90 });
    for (const durationMinutes of [-1, 0, 0.5, Number.NaN, Infinity, 1441]) {
      expect(() => validateScheduleTiming({ ...valid, durationMinutes }))
        .toThrow('INVALID_SCHEDULE_DURATION');
    }
  });

  it('rejects non-UTC, noncanonical and impossible stored timestamps', () => {
    for (const startsAtUtc of [
      '2026-10-19T08:00:00Z',
      '2026-10-19T10:00:00.000+02:00',
      '2026-10-19T08:00:00',
      '2026-02-30T08:00:00.000Z',
      '2026-10-19T24:00:00.000Z',
      '2026-03-29T02:30:00.000 Europe/Berlin',
      'not-a-date',
      '',
    ]) {
      expect(isUtcInstant(startsAtUtc)).toBe(false);
      expect(() => validateScheduleTiming({ ...valid, startsAtUtc }))
        .toThrow('INVALID_SCHEDULE_START_UTC');
    }
    expect(isUtcInstant(null)).toBe(false);
    expect(isUtcInstant(42)).toBe(false);
  });

  it('preserves unique UTC instants across DST overlap and uses the viewer timezone only for display', () => {
    const first = '2026-10-25T00:30:00.000Z';
    const second = '2026-10-25T01:30:00.000Z';
    expect(isUtcInstant(first)).toBe(true);
    expect(isUtcInstant(second)).toBe(true);
    expect(Date.parse(second) - Date.parse(first)).toBe(3600000);
    const berlin = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    expect(berlin.format(new Date(first))).toBe('02:30');
    expect(berlin.format(new Date(second))).toBe('02:30');
    const moscow = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    expect(moscow.format(new Date(first))).toBe('03:30');
    expect(moscow.format(new Date(second))).toBe('04:30');
  });
});
