import { describe, expect, it } from 'vitest';
import { buildLensEdgeCylinderSlices } from './lensEdgeCylinder';

describe('iOS picker lens edge cylinder', () => {
  it('samples a quarter-circle at each edge and leaves the middle untouched', () => {
    const radius = 16;
    const slices = buildLensEdgeCylinderSlices(72, radius, 8);
    const top = slices.filter(slice => slice.edge === 'top');
    const bottom = slices.filter(slice => slice.edge === 'bottom');

    expect(top).toHaveLength(8);
    expect(bottom).toHaveLength(8);
    expect(top[0].clipY).toBe(0);
    expect(top[7].clipY + top[7].clipHeight).toBeCloseTo(radius);
    expect(bottom[0].clipY).toBe(72 - radius);
    expect(bottom[7].clipY + bottom[7].clipHeight).toBeCloseTo(72);

    const sourceAt = (slice: (typeof slices)[number], destination: number) =>
      (destination - slice.translateY) / slice.scaleY;

    // Each 16px edge contains the arc length of a full quarter-cylinder.
    expect(sourceAt(top[0], 0)).toBeCloseTo(radius * (1 - Math.PI / 2));
    expect(sourceAt(top[7], radius)).toBeCloseTo(radius);
    expect(sourceAt(bottom[0], 72 - radius)).toBeCloseTo(72 - radius);
    expect(sourceAt(bottom[7], 72)).toBeCloseTo(72 + radius * (Math.PI / 2 - 1));
  });

  it('keeps segments continuous and mirrors the two edges', () => {
    const slices = buildLensEdgeCylinderSlices(72, 16, 8);
    const sourceAt = (slice: (typeof slices)[number], destination: number) =>
      (destination - slice.translateY) / slice.scaleY;

    for (let index = 0; index < 8; index += 1) {
      const top = slices[index];
      const mirroredBottom = slices[15 - index];
      expect(top.scaleY).toBeGreaterThan(0);
      expect(top.scaleY).toBeLessThanOrEqual(1);
      expect(top.scaleY).toBeCloseTo(mirroredBottom.scaleY);
      expect(top.opacity).toBeCloseTo(mirroredBottom.opacity);
      expect(top.opacity).toBeGreaterThan(0);
      expect(top.opacity).toBeLessThan(1);

      if (index > 0) {
        const previous = slices[index - 1];
        expect(sourceAt(previous, previous.clipY + previous.clipHeight))
          .toBeCloseTo(sourceAt(top, top.clipY));
      }
    }
  });

  it('rejects overlapping bands or invalid segment counts', () => {
    expect(() => buildLensEdgeCylinderSlices(72, 36, 12)).toThrow(RangeError);
    expect(() => buildLensEdgeCylinderSlices(72, 16, 0)).toThrow(RangeError);
    expect(() => buildLensEdgeCylinderSlices(72, 16, 2.5)).toThrow(RangeError);
  });
});
