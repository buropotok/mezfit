import { describe, expect, it } from 'vitest';
import {
  buildMonthGrid,
  calculateCenteredScrollTop,
  formatLocalDate,
  getWeekdayLabels,
  parseLocalDate,
} from './datePickerDate';

describe('datePickerDate', () => {
  it('parses and formats date-only values without timezone conversion', () => {
    expect(parseLocalDate('2026-09-25')).toEqual({ year: 2026, month: 9, day: 25 });
    expect(formatLocalDate(2026, 9, 5)).toBe('2026-09-05');
    expect(parseLocalDate('2026-02-29')).toBeNull();
    expect(parseLocalDate('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 });
  });

  it('builds Monday-first month grids', () => {
    const september2026 = buildMonthGrid(2026, 8);
    expect(september2026.slice(0, 7).map((cell) => cell.day)).toEqual([null, 1, 2, 3, 4, 5, 6]);
    expect(september2026.filter((cell) => cell.day !== null).at(-1)?.day).toBe(30);
    expect(september2026.length % 7).toBe(0);
  });

  it('centers the selected row and clamps at natural scroll boundaries', () => {
    expect(calculateCenteredScrollTop({
      targetOffset: 570,
      targetHeight: 34,
      viewportHeight: 376,
      scrollHeight: 946,
    })).toBe(399);

    expect(calculateCenteredScrollTop({
      targetOffset: 0,
      targetHeight: 34,
      viewportHeight: 376,
      scrollHeight: 946,
    })).toBe(0);

    expect(calculateCenteredScrollTop({
      targetOffset: 912,
      targetHeight: 34,
      viewportHeight: 376,
      scrollHeight: 946,
    })).toBe(570);
  });

  it('derives seven localized weekday labels starting from Monday', () => {
    expect(getWeekdayLabels('ru-RU')).toEqual(['п', 'в', 'с', 'ч', 'п', 'с', 'в']);
  });
});
