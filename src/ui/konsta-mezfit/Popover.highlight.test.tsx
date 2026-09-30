/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MezfitPopover } from './Popover';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());

  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 320,
    bottom: 240,
    width: 320,
    height: 240,
    toJSON: () => ({}),
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('MezfitPopover iOS highlight control', () => {
  it('can disable the Konsta iOS press highlight through the public API', () => {
    const view = render(
      <KonstaProvider theme="ios" dark>
        <MezfitPopover opened iosHighlight={false}>
          <span>Content</span>
        </MezfitPopover>
      </KonstaProvider>,
    );

    const glass = view.container.querySelector('.ui-glass-surface') as HTMLElement;
    expect(glass).not.toBeNull();

    fireEvent.pointerEnter(glass, {
      pointerType: 'touch',
      clientX: 120,
      clientY: 80,
    });

    expect(glass.style.scale).toBe('');
    expect(glass.querySelector('span[style*="radial-gradient"]')).toBeNull();
  });
});
