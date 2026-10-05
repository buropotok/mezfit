/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlassSurface } from './GlassSurface';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('GlassSurface contour', () => {
  it.each([undefined, 'M0,0H100V44H0Z'])('preserves the border while bezel highlights are hidden or revealed: %s', contour => {
    const view = render(<GlassSurface preset="frosted" contour={contour} />);
    const surface = view.container.firstElementChild as HTMLElement;
    const border = surface.style.getPropertyValue('--ui-glass-surface-border');
    const bezel = Number(surface.style.getPropertyValue('--ui-glass-surface-bezel'));
    expect(Number(border)).toBeGreaterThan(0);
    expect(bezel).toBeGreaterThan(0);
    for (const opacity of [0, 0.5, 1]) {
      view.rerender(<GlassSurface preset="frosted" contour={contour} bezelOpacity={opacity} />);
      expect(surface.style.getPropertyValue('--ui-glass-surface-border')).toBe(border);
      expect(Number(surface.style.getPropertyValue('--ui-glass-surface-bezel'))).toBeCloseTo(bezel * opacity);
      if (contour) {
        const edges = surface.querySelectorAll('.ui-glass-surface__contour-edge path');
        expect(edges[0].getAttribute('stroke-opacity')).toBe(border);
        expect(Number(edges[1].getAttribute('stroke-opacity'))).toBeCloseTo(bezel * opacity);
      }
    }
  });


  it('uses the same path for clipping, shadow and bezel without creating a lens', () => {
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const contour = 'M0,0H100V44H0Z';
    const view = render(<GlassSurface preset="frosted" contour={contour} />);
    const surface = view.container.firstElementChild as HTMLElement;
    expect(surface.style.getPropertyValue('--ui-glass-surface-blur')).toBe('14px');
    expect(surface.classList.contains('ui-glass-surface--contour')).toBe(true);
    expect(surface.querySelectorAll('path')).toHaveLength(4);
    surface.querySelectorAll('path').forEach(path => expect(path.getAttribute('d')).toBe(contour));
    expect(surface.querySelector('feDisplacementMap')).toBeNull();
    expect(context).not.toHaveBeenCalled();
    view.rerender(<GlassSurface preset="clear" contour="M0,0H56V56H0Z" />);
    expect(surface.style.getPropertyValue('--ui-glass-surface-blur')).toBe('2px');
    surface.querySelectorAll('path').forEach(path => expect(path.getAttribute('d')).toBe('M0,0H56V56H0Z'));
  });
});
