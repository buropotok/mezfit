/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiquidGlassSurface } from './LiquidGlassSurface';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 280,
    bottom: 120,
    width: 280,
    height: 120,
    toJSON: () => ({}),
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('LiquidGlassSurface', () => {
  it('renders the approved lens preset as an isolated reusable surface', () => {
    const view = render(
      <LiquidGlassSurface variant="lens" radius={34}>Glass</LiquidGlassSurface>,
    );
    const surface = view.container.firstElementChild as HTMLElement;
    expect(surface.classList.contains('ui-liquid-glass-surface')).toBe(true);
    expect(surface.style.borderRadius).toBe('34px');
    expect(surface.style.getPropertyValue('--ui-liquid-glass-blur')).toBe('0px');
    expect(surface.style.getPropertyValue('--ui-liquid-glass-saturation')).toBe('1.05');
    expect(surface.style.getPropertyValue('--ui-liquid-glass-tint-rgb')).toBe('20 20 20');
    expect(surface.style.getPropertyValue('--ui-liquid-glass-tint-alpha')).toBe('0.17');

    const displacementMaps = surface.querySelectorAll('feDisplacementMap');
    expect(displacementMaps).toHaveLength(3);
    expect(displacementMaps[0]?.getAttribute('scale')).toBe('8.1');
    expect(displacementMaps[1]?.getAttribute('scale')).toBe('8');
    expect(displacementMaps[2]?.getAttribute('scale')).toBe('7.9');
  });

  it('accepts live optics overrides without changing the preset contract', () => {
    const view = render(
      <LiquidGlassSurface
        variant="lens"
        optics={{
          blurPx: 18,
          saturation: 1.4,
          refraction: 12,
          rgbSpread: 0.5,
          tint: { r: 10, g: 70, b: 140, a: 0.3 },
        }}
      >
        Tuned
      </LiquidGlassSurface>,
    );
    const surface = view.container.firstElementChild as HTMLElement;
    expect(surface.style.getPropertyValue('--ui-liquid-glass-blur')).toBe('18px');
    expect(surface.style.getPropertyValue('--ui-liquid-glass-saturation')).toBe('1.4');
    expect(surface.style.getPropertyValue('--ui-liquid-glass-tint-rgb')).toBe('10 70 140');
    expect(surface.style.getPropertyValue('--ui-liquid-glass-tint-alpha')).toBe('0.3');

    const displacementMaps = surface.querySelectorAll('feDisplacementMap');
    expect(displacementMaps[0]?.getAttribute('scale')).toBe('12.5');
    expect(displacementMaps[1]?.getAttribute('scale')).toBe('12');
    expect(displacementMaps[2]?.getAttribute('scale')).toBe('11.5');
  });
});
