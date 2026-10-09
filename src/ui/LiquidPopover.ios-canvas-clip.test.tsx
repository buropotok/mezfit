/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, it, expect, vi } from 'vitest';
import { KonstaProvider } from 'konsta/react';
import { LiquidPopover } from './LiquidPopover';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('uses native Canvas contour clipping for the iOS LiquidPopover texture', async () => {
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
  const draws = vi.fn();
  const clip = vi.fn();
  const readPixels = vi.fn(() => {
    throw new Error("Animation pixel readback forbidden");
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    function (this: HTMLCanvasElement) {
      return {
        canvas: this,
        measureText: () => ({
          width: 8,
          actualBoundingBoxAscent: 12,
          actualBoundingBoxDescent: 3,
        }),
        fillText: vi.fn(),
        fillRect: vi.fn(),
        drawImage: draws,
        save: vi.fn(),
        restore: vi.fn(),
        resetTransform: vi.fn(),
        setTransform: vi.fn(),
        clearRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        closePath: vi.fn(),
        clip,
        translate: vi.fn(),
        scale: vi.fn(),
        fill: vi.fn(),
        getImageData: readPixels,
      } as unknown as CanvasRenderingContext2D;
    },
  );
  const encode = vi
    .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
    .mockImplementation(() => {
      throw new Error('Per-frame PNG forbidden');
    });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      const origin = this.tagName === 'BUTTON',
        x = origin ? 40 : 100,
        y = origin ? 40 : 140,
        width = origin ? 44 : 216,
        height = origin ? 44 : 112;
      return {
        x,
        y,
        left: x,
        top: y,
        width,
        height,
        right: x + width,
        bottom: y + height,
        toJSON: () => ({}),
      };
    },
  );
  const origin = createRef<HTMLButtonElement>(),
    select = vi.fn(),
    change = vi.fn();
  render(
    <KonstaProvider theme="ios" dark>
      <LiquidPopover
        isOpen
        renderMode="canvas"
        onOpenChange={change}
        triggerRef={origin}
        trigger={<button ref={origin}>Open</button>}
        items={[{ id: 'a', label: 'Action', onSelect: select }]}
      />
    </KonstaProvider>,
  );
  await act(async () => {
    vi.advanceTimersByTime(32);
  });
  const menu = screen.getByRole('menu'),
    canvas = menu.querySelector('canvas')!;
  expect(canvas.style.display).toBe('block');
  expect(canvas.style.clipPath).toBe('none');
  expect(menu.querySelector('image, feImage, feDisplacementMap')).toBeNull();
  await act(async () => {
    vi.advanceTimersByTime(1100);
  });
  expect(encode).not.toHaveBeenCalled();
  expect(readPixels).not.toHaveBeenCalled();
  expect(draws).toHaveBeenCalled();
  expect(clip).toHaveBeenCalled();
  expect(canvas.style.display).toBe('none');
  fireEvent.click(screen.getByRole('menuitem', { name: 'Action' }));
  expect(select).toHaveBeenCalledOnce();
  expect(change).toHaveBeenCalledWith(false);
});

