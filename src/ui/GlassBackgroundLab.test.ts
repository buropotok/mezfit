/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { RECOMMENDED_GLASS_BACKGROUND, hsvToHex } from './GlassBackgroundLab';

describe('GlassBackgroundLab color conversion', () => {
  it('keeps the recommended background aligned with its HSV defaults', () => {
    expect(hsvToHex({ hue: 219, saturation: 56, value: 43 })).toBe(RECOMMENDED_GLASS_BACKGROUND);
  });

  it('converts primary HSV colors to hex', () => {
    expect(hsvToHex({ hue: 0, saturation: 100, value: 100 })).toBe('#FF0000');
    expect(hsvToHex({ hue: 120, saturation: 100, value: 100 })).toBe('#00FF00');
    expect(hsvToHex({ hue: 240, saturation: 100, value: 100 })).toBe('#0000FF');
  });
});
