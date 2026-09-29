/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlassSurface } from './GlassSurface';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('GlassSurface active lifecycle', () => {
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
