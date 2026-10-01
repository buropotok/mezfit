/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlassSurface } from './GlassSurface';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('GlassSurface activation', () => {
  it('defers measurement and vector-map work while inactive', () => {
    let observerCount = 0;
    class ResizeObserverStub {
      constructor() {
        observerCount += 1;
      }
      observe() {}
      disconnect() {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    const measure = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    const view = render(<GlassSurface active={false} optics>Dormant</GlassSurface>);
    const surface = view.container.firstElementChild as HTMLElement;

    expect(surface.getAttribute('data-ui-glass-map-ready')).toBe('false');
    expect(observerCount).toBe(0);
    expect(measure).not.toHaveBeenCalled();
    expect(getContext).not.toHaveBeenCalled();

    view.rerender(<GlassSurface active optics>Active</GlassSurface>);

    expect(observerCount).toBe(1);
    expect(measure).toHaveBeenCalled();
  });

  it('measures the untransformed layout box when the visual rect is scaled to zero', () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    });

    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(287);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(173);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
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
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,activation-map');

    const view = render(<GlassSurface active optics>Visible</GlassSurface>);
    const image = view.container.querySelector('feImage');

    expect(image?.getAttribute('width')).toBe('287');
    expect(image?.getAttribute('height')).toBe('173');
  });
});
