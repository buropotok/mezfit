import { describe, expect, it } from 'vitest';
import { programMutationMessage, weekLabel } from './programPresentation';

describe('program presentation', () => {
  it.each([
    [1, 'неделя'], [2, 'недели'], [3, 'недели'], [4, 'недели'], [5, 'недель'],
    [10, 'недель'], [11, 'недель'], [12, 'недель'], [14, 'недель'], [20, 'недель'],
    [21, 'неделя'], [22, 'недели'], [23, 'недели'], [24, 'недели'], [25, 'недель'],
    [31, 'неделя'], [101, 'неделя'], [111, 'недель'], [112, 'недель'],
  ])('declines %s weeks as %s', (weeks, expected) => {
    expect(weekLabel(Number(weeks))).toBe(expected);
  });
  it('identifies denied writes separately from general sync notices', () => {
    const denied = new Error('Permission denied');
    denied.name = 'PermissionDeniedError';
    expect(programMutationMessage(denied)).toContain('отказал в доступе');
    expect(programMutationMessage(new Error('Другая ошибка'))).toBe('Другая ошибка');
  });
});
