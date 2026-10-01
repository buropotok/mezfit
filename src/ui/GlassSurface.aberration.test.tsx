/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlassSurface } from './GlassSurface';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GlassSurface refraction pipeline', () => {
  it('uses one displacement pass without chromatic channel splitting', () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 180,
      bottom: 100,
      width: 180,
      height: 100,
      toJSON: () => ({}),
    });

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

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,no-aberration-map');

    const view = render(<GlassSurface optics>Glass</GlassSurface>);
    const surface = view.container.firstElementChild as HTMLElement;

    expect(surface.getAttribute('data-ui-glass-map-ready')).toBe('true');
    expect(surface.querySelectorAll('feDisplacementMap')).toHaveLength(1);
    expect(surface.querySelector('feColorMatrix')).toBeNull();
    expect(surface.querySelector('feBlend')).toBeNull();
  });
});
