/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlassSurface } from './GlassSurface';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GlassSurface vector-map cache', () => {
  it('reuses a generated map when an identical glass surface remounts', () => {
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
      right: 173,
      bottom: 91,
      width: 173,
      height: 91,
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
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,cached-perf-map');

    const first = render(<GlassSurface>First</GlassSurface>);
    expect(first.container.firstElementChild?.getAttribute('data-ui-glass-map-ready')).toBe('true');
    const firstBuildCount = getContext.mock.calls.length;

    first.unmount();

    const second = render(<GlassSurface>Second</GlassSurface>);
    expect(second.container.firstElementChild?.getAttribute('data-ui-glass-map-ready')).toBe('true');
    expect(getContext.mock.calls.length).toBe(firstBuildCount);
  });
});
