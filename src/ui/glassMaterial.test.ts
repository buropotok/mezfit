/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GLASS_PRESETS,
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
      topGlint: 0.5,
      tintA: 0.18,
    });

    expect(material.refraction).toBe(10.7);
    expect(material.rimWidth).toBe(15.5);
    expect(material.depthWidth).toBe(34);
    expect(material.blur).toBe(8);
    expect(material.topGlint).toBe(0.5);
    expect(material.tintA).toBe(0.18);
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
      'lens',
      'clear',
      'frosted',
      'blue',
      'smoked',
    ]);
    expect(resolveGlassMaterial('clear').tintA).toBe(0.08);
    expect(resolveGlassMaterial('frosted').blur).toBe(14);
    expect(resolveGlassMaterial('smoked').shadow).toBe(0.28);
  });

  it('anchors compact auto geometry at 44px -> 22px and preserves the tuned modal radius', () => {
    expect(resolveGlassRadius(180, 44)).toBe(22);
    expect(resolveGlassRadius(332, 184)).toBeCloseTo(34.7, 1);
    expect(resolveGlassRadius(180, 100, 'capsule')).toBe(50);
    expect(resolveGlassRadius(180, 100, { radius: 24 })).toBe(24);
  });

  it('builds the edge-and-depth displacement map with bounded render resolution', () => {
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
