/** @vitest-environment jsdom */
import { act, cleanup, render } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MezfitPopover, MezfitSidePanel } from './index';

let frames: FrameRequestCallback[];

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
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

function runQueuedFrames() {
  const queued = frames;
  frames = [];
  act(() => {
    queued.forEach((callback) => callback(0));
  });
}

describe('Mezfit overlay glass prewarm', () => {
  it('prewarms floating SidePanel glass while the panel is still closed', () => {
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
    expect(frames.length).toBeGreaterThan(0);

    runQueuedFrames();

    expect(getContext).toHaveBeenCalled();
  });

  it('prewarms Popover glass while the popover is still closed', () => {
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
    expect(frames.length).toBeGreaterThan(0);

    runQueuedFrames();

    expect(getContext).toHaveBeenCalled();
  });
});
