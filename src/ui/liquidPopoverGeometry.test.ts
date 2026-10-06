import { describe, expect, it } from 'vitest';
import { resolveGlassRadius } from './glassMaterial';
import {
  createLiquidMotion,
  LIQUID_POPOVER_DEFAULTS,
  type Point,
} from './liquidPopoverGeometry';
import { contourBounds } from './liquidPopoverCanvas';
import { resolveLiquidMotionOptions } from './LiquidPopover';

const target = { x: 210, y: 280, w: 240, h: 192 };
const area = (points: Point[]) =>
  Math.abs(
    points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length];
      return sum + point.x * next.y - next.x * point.y;
    }, 0),
  ) / 2;

describe('LiquidPopover geometry contract', () => {
  it('uses the tuned reference defaults without expanding the public motion options', () => {
    expect(LIQUID_POPOVER_DEFAULTS).toEqual({
      duration: 0.65,
      sourceMorph: 0.055,
      tail: 32,
      ovalArea: 0.35,
      exponent: 2.5,
      growthDelay: 0.31,
      curvature: 0.92,
      smoothing: 1.3,
    });
  });
  it.each([
    { w: 88, h: 44 },
    { w: 44, h: 44 },
  ])(
    'starts at the measured button %o and moves during compression',
    (size) => {
      const source = { x: 80, y: 60, ...size },
        motion = createLiquidMotion(source, target);
      const initial = contourBounds(motion.contour(0));
      expect(initial.right - initial.left).toBeCloseTo(size.w, 0);
      expect(initial.bottom - initial.top).toBeCloseTo(size.h, 0);
      expect((initial.left + initial.right) / 2).toBeCloseTo(source.x, 0);
      const moving = motion.geometry(0.03);
      expect(moving.head.x).toBeGreaterThan(motion.geometry(0).head.x);
      expect(moving.r).toBeLessThan(source.h / 2);
    },
  );

  it('shrinks a center-crossing capsule in place before travelling vertically', () => {
    const source = { x: 190, y: 40, w: 80, h: 40 },
      motion = createLiquidMotion(source, target),
      shrinkEnd =
        LIQUID_POPOVER_DEFAULTS.sourceMorph /
        LIQUID_POPOVER_DEFAULTS.duration,
      halfwayShrink = contourBounds(motion.contour(shrinkEnd / 2)),
      circle = contourBounds(motion.contour(shrinkEnd)),
      travel = motion.geometry((shrinkEnd + motion.morphStart) / 2);

    expect((halfwayShrink.left + halfwayShrink.right) / 2).toBeCloseTo(
      source.x,
      3,
    );
    expect((halfwayShrink.top + halfwayShrink.bottom) / 2).toBeCloseTo(
      source.y,
      3,
    );
    expect(halfwayShrink.right - halfwayShrink.left).toBeLessThan(source.w);
    expect(halfwayShrink.right - halfwayShrink.left).toBeGreaterThan(source.h);

    expect(circle.right - circle.left).toBeCloseTo(source.h, 0);
    expect(circle.bottom - circle.top).toBeCloseTo(source.h, 0);
    expect((circle.left + circle.right) / 2).toBeCloseTo(source.x, 0);
    expect((circle.top + circle.bottom) / 2).toBeCloseTo(source.y, 0);

    expect(travel.head.x).toBeCloseTo(source.x, 3);
    expect(travel.head.y).toBeGreaterThan(source.y);
    expect(travel.head.y).toBeLessThan(target.y);
  });

  it('moves a centered round trigger immediately without an empty shrink phase', () => {
    const source = { x: target.x, y: 40, w: 44, h: 44 },
      motion = createLiquidMotion(source, target),
      early = motion.geometry(0.03);
    expect(early.head.x).toBeCloseTo(source.x, 3);
    expect(early.head.y).toBeGreaterThan(source.y);
  });

  it('uses the same centered route when the source only touches the target centerline', () => {
    const source = { x: 170, y: 40, w: 80, h: 40 },
      motion = createLiquidMotion(source, target),
      shrinkEnd =
        LIQUID_POPOVER_DEFAULTS.sourceMorph /
        LIQUID_POPOVER_DEFAULTS.duration,
      travel = motion.geometry((shrinkEnd + motion.morphStart) / 2);
    expect(source.x + source.w / 2).toBe(target.x);
    expect(travel.head.x).toBeCloseTo(source.x, 3);
    expect(travel.head.y).toBeGreaterThan(source.y);
  });

  it('finishes the tail in a centered 35% superellipse before morphing', () => {
    const motion = createLiquidMotion({ x: 60, y: 40, w: 88, h: 44 }, target),
      points = motion.contour(motion.morphStart)[0],
      bounds = contourBounds([points]);
    expect(area(points) / (target.w * target.h)).toBeCloseTo(0.35, 3);
    expect((bounds.left + bounds.right) / 2).toBeCloseTo(target.x, 3);
    expect((bounds.top + bounds.bottom) / 2).toBeCloseTo(target.y, 3);
    expect(motion.geometry(motion.morphStart).externalLength).toBe(0);
  });

  it('settles to the rectangle with the shared GlassSurface radius and no residual spring', () => {
    const motion = createLiquidMotion({ x: 350, y: 50, w: 44, h: 44 }, target);
    const points = motion.contour(1)[0],
      bounds = contourBounds([points]);
    expect(bounds.left).toBeCloseTo(target.x - target.w / 2, 3);
    expect(bounds.bottom).toBeCloseTo(target.y + target.h / 2, 3);
    const radius = resolveGlassRadius(target.w, target.h);
    const roundedArea = target.w * target.h - (4 - Math.PI) * radius * radius;
    expect(area(points)).toBeCloseTo(roundedArea, -1);
    expect(motion.spring(0.45)).toBe(0);
    expect(motion.totalSeconds).toBeCloseTo(0.65, 5);
  });

  it('settles asymmetric Apple-style edge overshoot to about 106%', () => {
    const motion = createLiquidMotion({ x: 350, y: 50, w: 44, h: 44 }, target);
    const samples = Array.from({ length: 121 }, (_, index) => {
      const progress =
          motion.morphStart +
          ((1 - motion.morphStart) * index) / 120,
        bounds = contourBounds(motion.contour(progress));
      return {
        progress,
        bounds,
        scale: Math.max(
          (bounds.right - bounds.left) / target.w,
          (bounds.bottom - bounds.top) / target.h,
        ),
      };
    });
    const peakScale = Math.max(...samples.map((sample) => sample.scale)),
      bottomPeak = samples.reduce((best, sample) =>
        sample.bounds.bottom > best.bounds.bottom ? sample : best),
      topPeak = samples.reduce((best, sample) =>
        sample.bounds.top < best.bounds.top ? sample : best);
    expect(peakScale).toBeCloseTo(1.06, 2);
    expect(bottomPeak.progress).toBeLessThan(topPeak.progress);
  });

  it('sanitizes malformed motion options without poisoning coordinates', () => {
    const options = resolveLiquidMotionOptions({
      duration: 0,
      sourceMorph: Number.NaN,
      exponent: Infinity,
      growthDelay: 1,
      curvature: -4,
    });
    expect(options.duration).toBe(0.1);
    expect(options.sourceMorph).toBe(LIQUID_POPOVER_DEFAULTS.sourceMorph);
    expect(options.exponent).toBe(2.5);
    const motion = createLiquidMotion(
      { x: 50, y: 40, w: 44, h: 44 },
      target,
      options,
    );
    expect(
      motion
        .contour(0.2)
        .flat()
        .every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
    ).toBe(true);
  });
});
