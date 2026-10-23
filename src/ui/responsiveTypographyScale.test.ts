import { describe, expect, it } from 'vitest';
import { responsiveTypographyScale } from './responsiveTypographyScale';

describe('responsive typography', () => {
  it('interpolates across the app shell width and clamps outside mobile range', () => {
    expect(responsiveTypographyScale(320)).toBeCloseTo(0.9);
    expect(responsiveTypographyScale(363)).toBeCloseTo(0.95);
    expect(responsiveTypographyScale(406)).toBe(1);
    expect(responsiveTypographyScale(280)).toBeCloseTo(0.9);
    expect(responsiveTypographyScale(600)).toBe(1);
    expect(responsiveTypographyScale(0)).toBe(1);
    expect(responsiveTypographyScale(Number.NaN)).toBe(1);
  });
});
