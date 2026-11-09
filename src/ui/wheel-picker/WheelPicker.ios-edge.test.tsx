// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimePicker } from '../time-picker/TimePicker';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function renderPicker(lensMode: 'ios' | 'displacement') {
  const target = document.createElement('button');
  document.body.appendChild(target);
  render(
    <KonstaProvider theme="ios" dark>
      <div className="k-ios dark">
        <TimePicker opened value="08:15" onChange={vi.fn()} onClose={vi.fn()}
          lensMode={lensMode} target={target} />
      </div>
    </KonstaProvider>,
  );
  return document.querySelector('.ui-time-picker__lens');
}

describe('WheelPicker iOS cylinder edge rendering', () => {
  it('reuses a single SVG wheel source in the flat core and 24 edge strips', () => {
    const lens = renderPicker('ios');
    expect(lens).not.toBeNull();
    const source = lens?.querySelector('[data-ui-picker-lens-source]');
    const core = lens?.querySelector('[data-ui-picker-lens-core]');
    const strips = Array.from(lens?.querySelectorAll('[data-ui-picker-lens-edge]') ?? []);
    expect(source).not.toBeNull();
    expect(core).not.toBeNull();
    expect(strips).toHaveLength(24);
    expect(strips.filter(strip => strip.getAttribute('data-ui-picker-lens-edge') === 'top'))
      .toHaveLength(12);
    expect(strips.filter(strip => strip.getAttribute('data-ui-picker-lens-edge') === 'bottom'))
      .toHaveLength(12);

    const href = `#${source?.id}`;
    expect(core?.querySelector('use')?.getAttribute('href')).toBe(href);
    expect(core?.querySelector('use')?.hasAttribute('transform')).toBe(false);
    expect(strips.every(strip => strip.querySelector('use')?.getAttribute('href') === href)).toBe(true);
    expect(strips.every(strip => strip.querySelector('use')?.getAttribute('transform')?.startsWith('matrix(1 0 0 '))).toBe(true);
    expect(lens?.querySelectorAll('.ui-time-picker__lens-text')).toHaveLength(6);
    expect(lens?.querySelectorAll('.ui-time-picker__lens-separator')).toHaveLength(1);
    expect(lens?.querySelector('feDisplacementMap')).toBeNull();
    expect(screen.getByRole('listbox', { name: 'Часы' })).toBeTruthy();
    expect(screen.getByRole('listbox', { name: 'Минуты' })).toBeTruthy();
  });

  it('does not insert cylinder slices into the displacement lens', () => {
    const lens = renderPicker('displacement');
    expect(lens?.querySelector('[data-ui-picker-lens-source]')).toBeNull();
    expect(lens?.querySelector('[data-ui-picker-lens-edge]')).toBeNull();
  });
});
