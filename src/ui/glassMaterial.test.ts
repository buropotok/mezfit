/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BEZEL_ONLY_GLASS,
  BEZEL_ONLY_LIGHTING,
  GLASS_PRESETS,
  LIQUID_CONVEX_GLASS,
  LIQUID_CONVEX_LIGHTING,
  MODAL_TUNED_GLASS,
  buildGlassVectorMap,
  resolveGlassMaterial,
  resolveGlassRadius,
} from './glassMaterial';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('glass material', () => {
  it('uses ModalTuned as the default material and merges public overrides', () => {
    const material = resolveGlassMaterial('modalTuned', {
      blur: 8,
      tintA: 0.18,
    });

    expect(material.refraction).toBe(10.7);
    expect(material.rimWidth).toBe(15.5);
    expect(material.trenchWidth).toBe(3);
    expect(material.blur).toBe(8);
    expect(material.tintA).toBe(0.18);
    expect('topGlint' in material).toBe(false);
    expect('thickness' in material).toBe(false);
    expect('rgbSpread' in material).toBe(false);
    expect(MODAL_TUNED_GLASS.tintR).toBe(24);
  });

  it('ignores undefined public overrides instead of corrupting preset values', () => {
    const maybeBlur: number | undefined = undefined;
    const material = resolveGlassMaterial('clear', { blur: maybeBlur });

    expect(material.blur).toBe(2);
    expect(Number.isFinite(material.blur)).toBe(true);
  });

  it('exposes the named UI-kit glass presets', () => {
    expect(Object.keys(GLASS_PRESETS)).toEqual([
      'modalTuned',
      'modal',
      'lens',
      'clear',
      'frosted',
      'blue',
      'smoked',
      'liquidConvex',
      'bezelOnly',
    ]);
    expect(resolveGlassMaterial('modal').blur).toBe(16);
    expect(resolveGlassMaterial('clear').tintA).toBe(0.08);
    expect(resolveGlassMaterial('frosted').blur).toBe(14);
    expect(resolveGlassMaterial('smoked').shadow).toBe(0.28);
    expect(resolveGlassMaterial('liquidConvex')).toEqual(LIQUID_CONVEX_GLASS);
    expect(LIQUID_CONVEX_LIGHTING.rectangleLightAngle).toBe(360);
    expect(LIQUID_CONVEX_LIGHTING.rectangleBezelAngle).toBe(346);
    expect(LIQUID_CONVEX_LIGHTING.capsuleLightAngle).toBe(243);
    expect(LIQUID_CONVEX_LIGHTING.capsuleBezelAngle).toBe(346);
    expect(resolveGlassMaterial('bezelOnly')).toEqual(BEZEL_ONLY_GLASS);
    expect(BEZEL_ONLY_LIGHTING.edgeWidth).toBe(16);
    expect(BEZEL_ONLY_LIGHTING.edgeOutset).toBe(22.5);
    expect(BEZEL_ONLY_LIGHTING.edgeLight).toBe(0.43);
    expect(BEZEL_ONLY_LIGHTING.edgeDark).toBe(0.55);
    expect(BEZEL_ONLY_LIGHTING.rectangleLightAngle).toBe(354);
    expect(BEZEL_ONLY_LIGHTING.rectangleBezelAngle).toBe(359);
    expect(BEZEL_ONLY_LIGHTING.capsuleLightAngle).toBe(359);
    expect(BEZEL_ONLY_LIGHTING.capsuleBezelAngle).toBe(350);
    expect(BEZEL_ONLY_LIGHTING.primaryStrength).toBe(1.49);
    expect(BEZEL_ONLY_LIGHTING.oppositeStrength).toBe(1.03);
  });

  it('anchors compact auto geometry at 44px -> 22px and preserves the tuned modal radius', () => {
    expect(resolveGlassRadius(180, 44)).toBe(22);
    expect(resolveGlassRadius(332, 184)).toBeCloseTo(34.7, 1);
    expect(resolveGlassRadius(180, 100, 'capsule')).toBe(50);
    expect(resolveGlassRadius(180, 100, { radius: 24 })).toBe(24);
  });

  it('builds the approved edge displacement map with bounded render resolution', () => {
    const canvas = document.createElement('canvas');
    const putImageData = vi.fn();
    const context = {
      createImageData(width: number, height: number) {
        return {
          data: new Uint8ClampedArray(width * height * 4),
          width,
          height,
          colorSpace: 'srgb',
        };
      },
      putImageData,
    } as unknown as CanvasRenderingContext2D;

    vi.spyOn(canvas, 'getContext').mockReturnValue(context);
    vi.spyOn(canvas, 'toDataURL').mockReturnValue('data:image/png;base64,glass-map');

    const result = buildGlassVectorMap(
      canvas,
      { width: 80, height: 44, radius: 22 },
      MODAL_TUNED_GLASS,
      3,
    );

    expect(result).toEqual({
      href: 'data:image/png;base64,glass-map',
      width: 80,
      height: 44,
    });
    expect(canvas.width).toBe(160);
    expect(canvas.height).toBe(88);
    expect(putImageData).toHaveBeenCalledOnce();
  });

  it('caps large displacement maps by total pixel count', () => {
    const canvas = document.createElement('canvas');
    const context = {
      createImageData(width: number, height: number) {
        return {
          data: new Uint8ClampedArray(width * height * 4),
          width,
          height,
          colorSpace: 'srgb',
        };
      },
      putImageData() {},
    } as unknown as CanvasRenderingContext2D;

    vi.spyOn(canvas, 'getContext').mockReturnValue(context);
    vi.spyOn(canvas, 'toDataURL').mockReturnValue('data:image/png;base64,glass-map-large');

    buildGlassVectorMap(
      canvas,
      { width: 430, height: 900, radius: 40 },
      MODAL_TUNED_GLASS,
      2,
    );

    expect(canvas.width * canvas.height).toBeLessThanOrEqual(450_000);
  });
});
