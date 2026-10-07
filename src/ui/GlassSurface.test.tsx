/** @vitest-environment jsdom */
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlassSurface, GlassSurfaceProvider } from './GlassSurface';

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
    right: 332,
    bottom: 184,
    width: 332,
    height: 184,
    toJSON: () => ({}),
  });

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('GlassSurface', () => {
  it('defaults optics to false and skips distortion calculation', () => {
    const view = render(<GlassSurface contentClassName="test-content">Glass</GlassSurface>);
    const surface = view.container.firstElementChild as HTMLElement;

    expect(surface.classList.contains('ui-glass-surface')).toBe(true);
    expect(Number.parseFloat(surface.style.borderRadius)).toBeCloseTo(34.7, 1);
    expect(surface.style.getPropertyValue('--ui-glass-surface-tint-r')).toBe('24');
    expect(surface.style.getPropertyValue('--ui-glass-surface-tint-g')).toBe('24');
    expect(surface.style.getPropertyValue('--ui-glass-surface-tint-b')).toBe('26');
    expect(surface.style.getPropertyValue('--ui-glass-surface-tint-a')).toBe('0.27');
    expect(surface.style.getPropertyValue('--ui-glass-surface-blur')).toBe('2px');
    expect(surface.style.getPropertyValue('--ui-glass-surface-bezel-top-left'))
      .toBe(surface.style.getPropertyValue('--ui-glass-surface-bezel'));
    expect(surface.style.getPropertyValue('--ui-glass-surface-bezel-bottom-right'))
      .toBe(surface.style.getPropertyValue('--ui-glass-surface-bezel'));
    expect(surface.style.getPropertyValue('--ui-glass-surface-top-glint')).toBe('');
    expect(surface.style.getPropertyValue('--ui-glass-surface-thickness')).toBe('');
    expect(surface.getAttribute('data-ui-glass-map-ready')).toBe('false');
    expect(surface.querySelector('feImage')).toBeNull();
    expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalled();
    expect(surface.querySelector('.test-content')?.textContent).toBe('Glass');
  });

  it('controls built-in bezel highlights independently while bezelOpacity remains the master multiplier', () => {
    const view = render(
      <GlassSurface
        preset="frosted"
        bezelOpacity={0.5}
        bezelHighlights={{ topLeft: 0.25, bottomRight: 1 }}
      >
        Split bezel
      </GlassSurface>,
    );
    const surface = view.container.firstElementChild as HTMLElement;
    const master = Number(surface.style.getPropertyValue('--ui-glass-surface-bezel'));

    expect(master).toBeGreaterThan(0);
    expect(Number(surface.style.getPropertyValue('--ui-glass-surface-bezel-top-left')))
      .toBeCloseTo(master * 0.25);
    expect(Number(surface.style.getPropertyValue('--ui-glass-surface-bezel-bottom-right')))
      .toBeCloseTo(master);

    view.rerender(
      <GlassSurface
        preset="frosted"
        bezelOpacity={0.5}
        bezelHighlights={{ topLeft: -1, bottomRight: 2 }}
      >
        Clamped bezel
      </GlassSurface>,
    );

    expect(Number(surface.style.getPropertyValue('--ui-glass-surface-bezel-top-left'))).toBe(0);
    expect(Number(surface.style.getPropertyValue('--ui-glass-surface-bezel-bottom-right')))
      .toBeCloseTo(master);
  });

  it('renders the liquid convex preset with scaled edge lighting and compatible split bezel controls', () => {
    const view = render(
      <GlassSurface
        preset="liquidConvex"
        bezelOpacity={0.5}
        bezelHighlights={{ primary: 0, opposite: 1 }}
      >
        Convex
      </GlassSurface>,
    );
    const surface = view.container.firstElementChild as HTMLElement;

    expect(surface.classList.contains('ui-glass-surface--liquid-convex')).toBe(true);
    expect(surface.style.getPropertyValue('--ui-glass-surface-border')).toBe('0');
    expect(surface.style.getPropertyValue('--ui-glass-surface-specular-angle')).toBe('346deg');
    expect(surface.style.getPropertyValue('--ui-glass-surface-specular-width')).toBe('1.1px');
    expect(Number(surface.style.getPropertyValue('--ui-glass-surface-specular-primary-alpha'))).toBe(0);
    expect(Number(surface.style.getPropertyValue('--ui-glass-surface-specular-opposite-alpha'))).toBeGreaterThan(0);
    expect(Number.parseFloat(surface.style.getPropertyValue('--ui-glass-surface-edge-outset'))).toBeGreaterThan(2.5);
    expect(Number.parseFloat(surface.style.getPropertyValue('--ui-glass-surface-edge-light-x'))).toBeGreaterThan(0);
    expect(Math.abs(Number.parseFloat(surface.style.getPropertyValue('--ui-glass-surface-edge-light-y'))))
      .toBeLessThan(0.001);

    view.rerender(
      <GlassSurface
        preset="liquidConvex"
        shape="capsule"
        bezelOpacity={0.5}
        bezelHighlights={{ topLeft: 1, bottomRight: 0 }}
      >
        Capsule
      </GlassSurface>,
    );

    expect(Number.parseFloat(surface.style.borderRadius)).toBeCloseTo(92, 1);
    expect(Number.parseFloat(surface.style.getPropertyValue('--ui-glass-surface-edge-light-x'))).toBeLessThan(0);
    expect(Number.parseFloat(surface.style.getPropertyValue('--ui-glass-surface-edge-light-y'))).toBeLessThan(0);
    expect(Number(surface.style.getPropertyValue('--ui-glass-surface-specular-primary-alpha'))).toBeGreaterThan(0);
    expect(Number(surface.style.getPropertyValue('--ui-glass-surface-specular-opposite-alpha'))).toBe(0);
  });

  it('renders bezel-only tuning with independent paired highlight controls', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(300);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(44);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 300,
      bottom: 44,
      width: 300,
      height: 44,
      toJSON: () => ({}),
    });

    const view = render(
      <GlassSurface
        preset="bezelOnly"
        bezelHighlights={{ primary: 1, opposite: 0 }}
      >
        Bezel only
      </GlassSurface>,
    );
    const surface = view.container.firstElementChild as HTMLElement;

    expect(surface.classList.contains('ui-glass-surface--directional')).toBe(true);
    expect(surface.classList.contains('ui-glass-surface--bezel-only')).toBe(true);
    expect(surface.style.getPropertyValue('--ui-glass-surface-border')).toBe('0');
    expect(surface.style.getPropertyValue('--ui-glass-surface-specular-angle')).toBe('350deg');
    expect(surface.style.getPropertyValue('--ui-glass-surface-edge-outset')).toBe('17.55px');
    expect(Number(surface.style.getPropertyValue('--ui-glass-surface-specular-primary-alpha'))).toBeGreaterThan(0);
    expect(Number(surface.style.getPropertyValue('--ui-glass-surface-specular-opposite-alpha'))).toBe(0);
    expect(surface.style.getPropertyValue('--ui-glass-surface-specular-gradient')).toContain('conic-gradient(');
  });

  it('uses capsule lighting when auto geometry resolves to a compact pill', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(180);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(44);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 180,
      bottom: 44,
      width: 180,
      height: 44,
      toJSON: () => ({}),
    });

    const view = render(<GlassSurface preset="liquidConvex">Auto capsule</GlassSurface>);
    const surface = view.container.firstElementChild as HTMLElement;

    expect(Number.parseFloat(surface.style.borderRadius)).toBeCloseTo(22, 1);
    expect(Number.parseFloat(surface.style.getPropertyValue('--ui-glass-surface-edge-light-x'))).toBeLessThan(0);
    expect(Number.parseFloat(surface.style.getPropertyValue('--ui-glass-surface-edge-light-y'))).toBeLessThan(0);
  });

  it('can replace an existing host element without changing its positioning or radius contract', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      borderTopLeftRadius: '32px',
    } as CSSStyleDeclaration);

    const view = render(
      <GlassSurface component="section" wrapContent={false} className="host-shell">
        <span data-testid="direct-child">Direct</span>
      </GlassSurface>,
    );
    const surface = view.container.firstElementChild as HTMLElement;

    expect(surface.tagName).toBe('SECTION');
    expect(surface.classList.contains('ui-glass-surface--host')).toBe(true);
    expect(surface.classList.contains('ui-glass-surface--standalone')).toBe(false);
    expect(surface.classList.contains('host-shell')).toBe(true);
    expect(surface.style.position).toBe('');
    expect(surface.style.borderRadius).toBe('');
    expect(surface.querySelector('.ui-glass-surface__content')).toBeNull();
    expect(surface.querySelector('[data-testid="direct-child"]')?.parentElement).toBe(surface);
  });

  it('inherits global optics while a direct override remains authoritative', async () => {
    const view = render(
      <GlassSurfaceProvider optics>
        <GlassSurface>Inherited optics</GlassSurface>
      </GlassSurfaceProvider>,
    );

    await waitFor(() => {
      expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalled();
    });

    vi.mocked(HTMLCanvasElement.prototype.getContext).mockClear();

    view.rerender(
      <GlassSurfaceProvider optics>
        <GlassSurface optics={false}>Direct optics override</GlassSurface>
      </GlassSurfaceProvider>,
    );

    await Promise.resolve();
    expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalled();
  });

  it('inherits global blur while direct and legacy overrides remain compatible', () => {
    const view = render(
      <GlassSurfaceProvider blur={7}>
        <GlassSurface preset="frosted">Inherited blur</GlassSurface>
      </GlassSurfaceProvider>,
    );
    const surface = view.container.querySelector('.ui-glass-surface') as HTMLElement;

    expect(surface.style.getPropertyValue('--ui-glass-surface-blur')).toBe('7px');

    view.rerender(
      <GlassSurfaceProvider blur={7}>
        <GlassSurface preset="frosted" blur={6}>Direct blur</GlassSurface>
      </GlassSurfaceProvider>,
    );

    expect(surface.style.getPropertyValue('--ui-glass-surface-blur')).toBe('6px');

    view.rerender(
      <GlassSurfaceProvider blur={7}>
        <GlassSurface preset="frosted" blur={6} glass={{ blur: 9 }}>
          Legacy override
        </GlassSurface>
      </GlassSurfaceProvider>,
    );

    expect(surface.style.getPropertyValue('--ui-glass-surface-blur')).toBe('9px');
  });

  it('applies a named preset before public material overrides', () => {
    const view = render(
      <GlassSurface
        preset="clear"
        glass={{ blur: 5 }}
      >
        Clear
      </GlassSurface>,
    );
    const surface = view.container.firstElementChild as HTMLElement;

    expect(surface.style.getPropertyValue('--ui-glass-surface-tint-a')).toBe('0.08');
    expect(surface.style.getPropertyValue('--ui-glass-surface-saturation')).toBe('1.08');
    expect(surface.style.getPropertyValue('--ui-glass-surface-blur')).toBe('5px');
  });

  it('exposes material and shape overrides through the public API', () => {
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

    const view = render(
      <GlassSurface
        shape="capsule"
        glass={{
          tintR: 10,
          tintG: 70,
          tintB: 140,
          tintA: 0.3,
          blur: 18,
          saturation: 1.4,
          brightness: 1.1,
          refraction: 12,
          bezel: 0.7,
          border: 0.08,
        }}
      >
        Tuned
      </GlassSurface>,
    );
    const surface = view.container.firstElementChild as HTMLElement;

    expect(Number.parseFloat(surface.style.borderRadius)).toBe(60);
    expect(surface.style.getPropertyValue('--ui-glass-surface-tint-r')).toBe('10');
    expect(surface.style.getPropertyValue('--ui-glass-surface-tint-g')).toBe('70');
    expect(surface.style.getPropertyValue('--ui-glass-surface-tint-b')).toBe('140');
    expect(surface.style.getPropertyValue('--ui-glass-surface-tint-a')).toBe('0.3');
    expect(surface.style.getPropertyValue('--ui-glass-surface-blur')).toBe('18px');
    expect(surface.style.getPropertyValue('--ui-glass-surface-saturation')).toBe('1.4');
    expect(surface.style.getPropertyValue('--ui-glass-surface-brightness')).toBe('1.1');
    expect(surface.style.getPropertyValue('--ui-glass-surface-bezel')).toBe('0.7');
    expect(surface.style.getPropertyValue('--ui-glass-surface-bezel-top-left')).toBe('0.7');
    expect(surface.style.getPropertyValue('--ui-glass-surface-bezel-bottom-right')).toBe('0.7');
    expect(surface.style.getPropertyValue('--ui-glass-surface-border')).toBe('0.08');
  });
});
