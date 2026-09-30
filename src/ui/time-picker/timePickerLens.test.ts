import { describe, expect, it } from 'vitest';
import { buildTimeLensVectorFields, type TimeLensVectorField } from './timePickerLens';

function sample(field: TimeLensVectorField, logicalX: number, logicalY: number) {
  const pixelRatioX = field.width / 288;
  const pixelRatioY = field.height / 72;
  const x = Math.max(0, Math.min(field.width - 1, Math.floor(logicalX * pixelRatioX)));
  const y = Math.max(0, Math.min(field.height - 1, Math.floor(logicalY * pixelRatioY)));
  const offset = (y * field.width + x) * 4;

  return {
    r: field.pixels[offset],
    g: field.pixels[offset + 1],
    b: field.pixels[offset + 2],
    a: field.pixels[offset + 3],
  };
}

describe('time picker magnifying lens vector maps', () => {
  it('keeps the edge map neutral in the center and bends samples at the capsule rim', () => {
    const { edge } = buildTimeLensVectorFields();

    expect(sample(edge, 144, 36)).toMatchObject({ r: 128, g: 128, b: 128, a: 255 });
    expect(sample(edge, 3, 36).r).not.toBe(128);
  });

  it('encodes the zoom map as an inward sampling field around the center', () => {
    const { zoom } = buildTimeLensVectorFields();
    const center = sample(zoom, 144, 36);
    const left = sample(zoom, 72, 36);
    const right = sample(zoom, 216, 36);

    expect(Math.abs(center.r - 128)).toBeLessThanOrEqual(1);
    expect(left.r).toBeGreaterThan(128);
    expect(right.r).toBeLessThan(128);
    expect(zoom.scale).toBeGreaterThan(1);
  });

  it('keeps the specular image transparent away from the rim and lights the facing edge', () => {
    const { specular } = buildTimeLensVectorFields();

    expect(sample(specular, 144, 36).a).toBe(0);
    expect(sample(specular, 144, 1).a).toBeGreaterThan(0);
  });
});
