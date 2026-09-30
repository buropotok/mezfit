/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MezfitPanel } from './Panel';

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
    right: 288,
    bottom: 720,
    width: 288,
    height: 720,
    toJSON: () => ({}),
  });

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('MezfitPanel cold-start prewarm', () => {
  it('keeps a closed iOS floating glass panel paintable but inert offscreen', () => {
    const renderPanel = (opened: boolean) => (
      <KonstaProvider theme="ios" dark>
        <div className="k-ios dark">
          <MezfitPanel
            opened={opened}
            floating
            side="right"
            role="dialog"
            aria-label="Prewarmed panel"
          >
            <button type="button">Action</button>
          </MezfitPanel>
        </div>
      </KonstaProvider>
    );

    const view = render(renderPanel(false));
    const panel = view.container.querySelector<HTMLElement>('.ui-glass-surface');

    expect(panel).toBeTruthy();
    expect(panel?.className).toContain('invisible');
    expect(panel?.style.visibility).toBe('visible');
    expect(panel?.style.pointerEvents).toBe('none');
    expect(panel?.getAttribute('aria-hidden')).toBe('true');
    expect(panel?.hasAttribute('inert')).toBe(true);
    expect(panel?.getAttribute('data-ui-glass-prewarm')).toBe('true');

    view.rerender(renderPanel(true));

    const openedPanel = view.container.querySelector<HTMLElement>('.ui-glass-surface');
    expect(openedPanel?.style.visibility).toBe('');
    expect(openedPanel?.style.pointerEvents).toBe('');
    expect(openedPanel?.hasAttribute('aria-hidden')).toBe(false);
    expect(openedPanel?.hasAttribute('inert')).toBe(false);
    expect(openedPanel?.hasAttribute('data-ui-glass-prewarm')).toBe(false);
  });
});
