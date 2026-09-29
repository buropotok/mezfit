/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlassSurface } from './GlassSurface';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GlassSurface active lifecycle', () => {
  it('retains a generated displacement map while inactive and reuses it on reopen', () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 160,
      bottom: 80,
      width: 160,
      height: 80,
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

    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,cached-map');

    const view = render(<GlassSurface active>Glass</GlassSurface>);
    const surface = view.container.firstElementChild as HTMLElement;

    expect(surface.dataset.uiGlassMapReady).toBe('true');
    const initialBuildCalls = getContext.mock.calls.length;
    expect(initialBuildCalls).toBeGreaterThan(0);

    view.rerender(<GlassSurface active={false}>Glass</GlassSurface>);
    expect(surface.dataset.uiGlassMapReady).toBe('false');

    view.rerender(<GlassSurface active>Glass</GlassSurface>);
    expect(surface.dataset.uiGlassMapReady).toBe('true');
    expect(getContext.mock.calls.length).toBe(initialBuildCalls);
  });

  it('does not measure or build a displacement map while inactive', () => {
    const measure = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    const view = render(<GlassSurface active={false}>Hidden glass</GlassSurface>);
    const surface = view.container.firstElementChild as HTMLElement;

    expect(surface.getAttribute('data-ui-glass-map-ready')).toBe('false');
    expect(measure).not.toHaveBeenCalled();
    expect(getContext).not.toHaveBeenCalled();
  });
});
