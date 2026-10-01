/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MezfitPopover, MezfitSidePanel } from './index';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });

  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(280);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(320);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 280,
    bottom: 320,
    width: 280,
    height: 320,
    toJSON: () => ({}),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Mezfit overlay glass optics', () => {
  it('does not calculate floating SidePanel distortion while closed by default', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    const view = render(
      <KonstaProvider theme="ios" dark>
        <MezfitSidePanel side="right" opened={false} floating>
          <span>Empty panel</span>
        </MezfitSidePanel>
      </KonstaProvider>,
    );

    const surface = view.container.querySelector<HTMLElement>('.ui-glass-surface');
    expect(surface).toBeTruthy();
    expect(surface?.getAttribute('data-ui-glass-map-ready')).toBe('false');
    expect(getContext).not.toHaveBeenCalled();
  });

  it('does not calculate Popover distortion while closed by default', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    const view = render(
      <KonstaProvider theme="ios" dark>
        <MezfitPopover opened={false}>
          <span>Empty popover</span>
        </MezfitPopover>
      </KonstaProvider>,
    );

    const surface = view.container.querySelector<HTMLElement>('.ui-glass-surface');
    expect(surface).toBeTruthy();
    expect(surface?.getAttribute('data-ui-glass-map-ready')).toBe('false');
    expect(getContext).not.toHaveBeenCalled();
  });
});
