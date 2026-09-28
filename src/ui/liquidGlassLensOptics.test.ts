/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildLiquidGlassVectorMap,
  resolveLiquidGlassOptics,
} from './liquidGlassLensOptics';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('liquid glass lens optics', () => {
  it('preserves the approved Lens preset while merging narrow overrides', () => {
    const optics = resolveLiquidGlassOptics('lens', {
      blurPx: 12,
      tint: { a: 0.24 },
    });

    expect(optics.refraction).toBe(8);
    expect(optics.rgbSpread).toBe(0.1);
    expect(optics.blurPx).toBe(12);
    expect(optics.tint).toEqual({ r: 20, g: 20, b: 20, a: 0.24 });
  });

  it('builds a displacement vector map for rounded-rectangle geometry', () => {
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
    vi.spyOn(canvas, 'toDataURL').mockReturnValue('data:image/png;base64,vector-map');

    const optics = resolveLiquidGlassOptics('lens');
    const result = buildLiquidGlassVectorMap(
      canvas,
      { width: 80, height: 44, radius: 12 },
      optics,
      1.5,
    );

    expect(result).toEqual({
      href: 'data:image/png;base64,vector-map',
      width: 80,
      height: 44,
    });
    expect(canvas.width).toBe(128);
    expect(canvas.height).toBe(72);
    expect(putImageData).toHaveBeenCalledOnce();
  });
});
