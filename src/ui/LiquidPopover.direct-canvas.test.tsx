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
import { paintLiquidMesh, sampleLiquidRim } from './liquidPopoverCanvas';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('renders moving text without serializing or decoding frame images', async () => {
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

it('keeps the center and exterior neutral, with inward displacement at the rim', () => {
  const points = [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 120 }, { x: 0, y: 120 }];
  expect(sampleLiquidRim(points, { x: 60, y: 60 }, 27)).toEqual({ x: 0, y: 0 });
  expect(sampleLiquidRim(points, { x: -4, y: 60 }, 27)).toEqual({ x: 0, y: 0 });
  expect(sampleLiquidRim(points, { x: 4, y: 60 }, 27).x).toBeGreaterThan(0);
  expect(sampleLiquidRim(points, { x: 60, y: 116 }, 27).y).toBeLessThan(0);
});

it('handles repeated contour vertices and translated shapes', () => {
  const points = [{ x: 20, y: 30 }, { x: 20, y: 30 }, { x: 140, y: 30 }, { x: 140, y: 150 }, { x: 20, y: 150 }];
  const offset = sampleLiquidRim(points, { x: 24, y: 90 }, 27);
  expect(Number.isFinite(offset.x)).toBe(true);
  expect(offset.x).toBeGreaterThan(0);
  expect(offset.y).toBe(0);
});

it('bounds a deformed frame to 96 texture draws and settles with one draw', () => {
  const drawImage = vi.fn();
  const noop = () => {};
  const context = {
    canvas: { width: 200, height: 200 }, drawImage,
    resetTransform: noop, clearRect: noop, save: noop, restore: noop,
    beginPath: noop, moveTo: noop, lineTo: noop, closePath: noop,
    clip: noop, setTransform: noop, translate: noop, scale: noop,
  } as unknown as CanvasRenderingContext2D;
  const source = { width: 120, height: 120 } as HTMLCanvasElement;
  const loops = [[{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 120 }, { x: 0, y: 120 }]];
  const rect = { x: 60, y: 60, w: 120, h: 120 };
  paintLiquidMesh(context, source, loops, 0.5, rect, 0, 1);
  expect(drawImage).toHaveBeenCalledTimes(96);
  drawImage.mockClear();
  paintLiquidMesh(context, source, loops, 1, rect, 0, 0);
  expect(drawImage).toHaveBeenCalledOnce();
});
