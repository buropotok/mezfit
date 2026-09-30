import { describe, expect, it } from 'vitest';
import {
  MODAL_TUNED_GLASS,
  resolveGlassFilterRegion,
} from './glassMaterial';

describe('glass filter region', () => {
  it('uses only the optical extent around a large modal surface', () => {
    const region = resolveGlassFilterRegion(
      { width: 288, height: 800 },
      MODAL_TUNED_GLASS,
    );

    expect(region.paddingX).toBeCloseTo(6.49, 2);
    expect(region.paddingY).toBeCloseTo(2.34, 2);

    const areaMultiplier = (1 + region.paddingX * 2 / 100)
      * (1 + region.paddingY * 2 / 100);

    expect(areaMultiplier).toBeLessThan(1.2);
  });

  it('keeps the approved padding value as a hard ceiling on compact surfaces', () => {
    const region = resolveGlassFilterRegion(
      { width: 24, height: 24 },
      MODAL_TUNED_GLASS,
    );

    expect(region).toEqual({
      paddingX: 51,
      paddingY: 51,
    });
  });
});
