import { describe, expect, it } from 'vitest';
import { nearestSettledIndex } from './forwardSettle';

describe('nearest-center post-momentum alignment', () => {
  it.each([
    [10.1, 10], [10.49, 10], [10.5, 11], [10.51, 11], [10.9, 11], [10, 10],
  ])('selects the nearest center at row %s', (row, expected) => {
    expect(nearestSettledIndex(row * 36, 36, 60)).toBe(expected);
  });

  it('clamps overscroll to the finite range', () => {
    expect(nearestSettledIndex(-20, 36, 60)).toBe(0);
    expect(nearestSettledIndex(60 * 36, 36, 60)).toBe(59);
    expect(nearestSettledIndex(24 * 36, 36, 24)).toBe(23);
  });
});
