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
import { buildLiquidMap, sampleLiquidMap } from './liquidPopoverCanvas';

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
        clip: vi.fn(),
        translate: vi.fn(),
        scale: vi.fn(),
        fill: vi.fn(),
        getImageData: (
          _x: number,
          _y: number,
          width: number,
          height: number,
        ) => ({ data: new Uint8ClampedArray(width * height * 4) }),
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
  expect(menu.querySelector('image, feImage, feDisplacementMap')).toBeNull();
  await act(async () => {
    vi.advanceTimersByTime(1100);
  });
  expect(encode).not.toHaveBeenCalled();
  expect(draws).toHaveBeenCalled();
  expect(canvas.style.display).toBe('none');
  fireEvent.click(screen.getByRole('menuitem', { name: 'Action' }));
  expect(select).toHaveBeenCalledOnce();
  expect(change).toHaveBeenCalledWith(false);
});

it('samples an exactly neutral center and interpolates edge displacement', () => {
  const vectors = new Float32Array(3 * 3 * 2);
  vectors[0] = 8;
  vectors[1] = 4;
  const map = {
    x: 0,
    y: 0,
    width: 30,
    height: 30,
    columns: 3,
    rows: 3,
    vectors,
  };
  expect(sampleLiquidMap(map, { x: 15, y: 15 })).toEqual({ x: 0, y: 0 });
  expect(sampleLiquidMap(map, { x: 5, y: 5 })).toEqual({ x: 2, y: 1 });
});

it('builds a field that leaves the center flat and stretches toward the rim', () => {
  vi.stubGlobal('Path2D', class {});
  const context = {
    canvas: { width: 0, height: 0 },
    setTransform: vi.fn(),
    resetTransform: vi.fn(),
    fill: vi.fn(),
    getImageData: (_x: number, _y: number, width: number, height: number) => {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let y = 20; y <= height - 20; y++)
        for (let x = 20; x <= width - 20; x++)
          data[(y * width + x) * 4 + 3] = 255;
      return { data };
    },
  } as unknown as CanvasRenderingContext2D;
  const map = buildLiquidMap(
    context,
    [
      [
        { x: 0, y: 0 },
        { x: 120, y: 0 },
        { x: 120, y: 120 },
        { x: 0, y: 120 },
      ],
    ],
    'M0 0H120V120H0Z',
  );
  expect(sampleLiquidMap(map, { x: 60, y: 60 })).toEqual({ x: 0, y: 0 });
  expect(sampleLiquidMap(map, { x: 4, y: 60 }).x).toBeGreaterThan(0);
  expect(sampleLiquidMap(map, { x: 60, y: 116 }).y).toBeLessThan(0);
});
