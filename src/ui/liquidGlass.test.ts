import { describe, expect, it } from 'vitest';
import {
  LIQUID_GLASS_TABS_PRESET,
  liquidGlassDifferentTabProgress,
  liquidGlassFullLensSize,
  liquidGlassSameTabProgress,
} from './liquidGlass';

describe('liquidGlass tabs physics', () => {
  it('opens fully at half of the fixed travel and closes by the destination for a short tap', () => {
    const travel = LIQUID_GLASS_TABS_PRESET.selectorTravelDurationMs;
    const half = travel / 2;

    expect(liquidGlassDifferentTabProgress(0, travel, false, half)).toBe(0);
    expect(liquidGlassDifferentTabProgress(half, travel, false, half)).toBe(1);
    expect(liquidGlassDifferentTabProgress(half + half / 2, travel, false, half)).toBeCloseTo(.5);
    expect(liquidGlassDifferentTabProgress(travel, travel, false, half)).toBe(0);
  });

  it('holds a fully opened lens while the pointer stays down after the midpoint', () => {
    const travel = LIQUID_GLASS_TABS_PRESET.selectorTravelDurationMs;
    expect(liquidGlassDifferentTabProgress(travel * .75, travel, true, null)).toBe(1);
  });

  it('keeps same-tab presses proportional to actual press duration', () => {
    const travel = LIQUID_GLASS_TABS_PRESET.selectorTravelDurationMs;
    const half = travel / 2;

    expect(liquidGlassSameTabProgress(half * .25, travel, true, 0, null)).toBeCloseTo(.25);
    expect(liquidGlassSameTabProgress(half * .5, travel, true, 0, null)).toBeCloseTo(.5);
    expect(liquidGlassSameTabProgress(half, travel, true, 0, null)).toBe(1);
  });

  it('returns a released same-tab press from the reached size at the same rate', () => {
    const travel = LIQUID_GLASS_TABS_PRESET.selectorTravelDurationMs;
    const half = travel / 2;
    const reached = .5;
    const closeStart = 130;

    expect(liquidGlassSameTabProgress(closeStart, travel, false, reached, closeStart)).toBe(reached);
    expect(liquidGlassSameTabProgress(closeStart + half * .25, travel, false, reached, closeStart)).toBeCloseTo(.25);
    expect(liquidGlassSameTabProgress(closeStart + half * .5, travel, false, reached, closeStart)).toBe(0);
  });

  it('keeps the approved inside-only selector spring preset', () => {
    expect(LIQUID_GLASS_TABS_PRESET.selectorSpring).toEqual({
      durationMs: 1360,
      firstHeightShrinkPercent: 16,
      firstWidthToHeightPercent: 100,
      secondWidthShrinkPercent: 11,
      secondHeightShrinkPercent: 3,
      firstSquashPointPercent: 18,
      firstReturnPointPercent: 52,
      secondSquashPointPercent: 64,
    });
  });

  it('keeps default text lenses wide enough for their actual selector', () => {
    const size = liquidGlassFullLensSize(48, 120, 'default');
    expect(size.height).toBe(60);
    expect(size.width).toBeGreaterThanOrEqual(126);
  });
});
