/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlassSurface } from './GlassSurface';

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
  it('renders ModalTuned by default without emitting an empty displacement href', () => {
    const view = render(<GlassSurface contentClassName="test-content">Glass</GlassSurface>);
    const surface = view.container.firstElementChild as HTMLElement;

    expect(surface.classList.contains('ui-glass-surface')).toBe(true);
    expect(Number.parseFloat(surface.style.borderRadius)).toBeCloseTo(34.7, 1);
    expect(surface.style.getPropertyValue('--ui-glass-surface-tint-r')).toBe('24');
    expect(surface.style.getPropertyValue('--ui-glass-surface-tint-g')).toBe('24');
    expect(surface.style.getPropertyValue('--ui-glass-surface-tint-b')).toBe('26');
    expect(surface.style.getPropertyValue('--ui-glass-surface-tint-a')).toBe('0.27');
    expect(surface.style.getPropertyValue('--ui-glass-surface-blur')).toBe('2px');
    expect(surface.style.getPropertyValue('--ui-glass-surface-top-glint')).toBe('');
    expect(surface.style.getPropertyValue('--ui-glass-surface-thickness')).toBe('');
    expect(surface.getAttribute('data-ui-glass-map-ready')).toBe('false');
    expect(surface.querySelector('feImage')).toBeNull();
    expect(surface.querySelector('.test-content')?.textContent).toBe('Glass');
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
          rgbSpread: 0.5,
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
    expect(surface.style.getPropertyValue('--ui-glass-surface-border')).toBe('0.08');
  });
});
