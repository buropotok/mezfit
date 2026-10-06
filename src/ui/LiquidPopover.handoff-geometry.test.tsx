/** @vitest-environment jsdom */
import { act, cleanup, render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { KonstaProvider } from 'konsta/react';
import { LiquidPopover } from './LiquidPopover';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('repaints the opening texture from positioned native row geometry', async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('CanvasRenderingContext2D', class {});
  vi.stubGlobal('Path2D', class {});
  vi.stubGlobal('CSS', { supports: () => true });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 16),
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) =>
    window.clearTimeout(id),
  );
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now());

  const fillText = vi.fn(),
    drawImage = vi.fn(),
    context = {
      measureText: () => ({
        width: 32,
        actualBoundingBoxAscent: 12,
        actualBoundingBoxDescent: 3,
      }),
      fillText,
      fillRect: vi.fn(),
      drawImage,
      save: vi.fn(),
      restore: vi.fn(),
      resetTransform: vi.fn(),
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      clip: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      fill: vi.fn(),
    };

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    function (this: HTMLCanvasElement) {
      return {
        ...context,
        canvas: this,
      } as unknown as CanvasRenderingContext2D;
    },
  );

  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      let left = 100,
        top = 140,
        width = 216,
        height = 160;

      if (this.textContent === 'Open') {
        left = 40;
        top = 40;
        width = 44;
        height = 44;
      } else if (this.classList.contains('ui-liquid-popover__measure')) {
        left = -10000;
        top = 0;
        width = 216;
        height = 200;
      } else if (
        this.classList.contains('ui-menu-item') &&
        this.parentElement?.classList.contains('ui-liquid-popover__measure')
      ) {
        left = -9984;
        top = this.textContent === 'Second' ? 80 : 20;
        width = 184;
        height = 48;
      } else if (
        this.classList.contains('ui-menu-item') &&
        this.parentElement?.classList.contains('ui-liquid-popover__native')
      ) {
        left = 116;
        top = this.textContent === 'Second' ? 204 : 156;
        width = 184;
        height = 48;
      }

      return {
        x: left,
        y: top,
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
        toJSON: () => ({}),
      };
    },
  );

  const origin = createRef<HTMLButtonElement>();
  render(
    <KonstaProvider theme="ios" dark>
      <LiquidPopover
        isOpen
        onOpenChange={() => {}}
        triggerRef={origin}
        trigger={<button ref={origin}>Open</button>}
        items={[
          { id: 'first', label: 'First' },
          { id: 'second', label: 'Second' },
        ]}
      />
    </KonstaProvider>,
  );

  await act(async () => {
    vi.advanceTimersByTime(32);
  });

  const secondCalls = fillText.mock.calls.filter(([label]) => label === 'Second');
  expect(secondCalls.length).toBeGreaterThanOrEqual(2);

  const [, , finalBaseline] = secondCalls.at(-1)!;
  // Native row top is 204 and host top is 140, so y=64. With a 48 px row
  // and mocked 12/3 font metrics, the exact native baseline is 92.5 px.
  expect(finalBaseline).toBeCloseTo(92.5, 3);
  // Hidden prewarm geometry places the same row at y=80 and would produce
  // 108.5 px; the opening texture must not retain that coordinate system.
  expect(finalBaseline).not.toBeCloseTo(108.5, 3);
  expect(drawImage).toHaveBeenCalled();
});
