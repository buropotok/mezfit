/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiquidPopover } from './LiquidPopover';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 16),
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) =>
    window.clearTimeout(id),
  );
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup() {
  const triggerRef = createRef<HTMLButtonElement>(),
    select = vi.fn(),
    change = vi.fn(),
    presentation = vi.fn();
  const props = {
    trigger: <button ref={triggerRef}>Открыть</button>,
    triggerRef,
    onOpenChange: change,
    onPresentationChange: presentation,
    items: [
      { id: 'edit', label: 'Редактировать', onSelect: select },
      { id: 'disabled', label: 'Недоступно', disabled: true },
    ],
  };
  const view = render(<LiquidPopover {...props} isOpen={false} />);
  return { ...view, props, select, change, presentation };
}

describe('LiquidPopover lifecycle and menu ownership', () => {
  it('retains live menu semantics and disabled actions without canvas support', async () => {
    const view = setup();
    view.rerender(<LiquidPopover {...view.props} isOpen />);
    await act(async () => {
      vi.advanceTimersByTime(32);
    });
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(
      screen
        .getByRole('menuitem', { name: 'Редактировать' })
        .closest('[inert]'),
    ).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Недоступно' }));
    expect(view.change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Редактировать' }));
    expect(view.select).toHaveBeenCalledOnce();
    expect(view.change).toHaveBeenCalledWith(false);
  });

  it('cancels a pending opening when closed, and supports reopening', async () => {
    const view = setup(),
      cancel = vi.spyOn(window, 'cancelAnimationFrame');
    view.rerender(<LiquidPopover {...view.props} isOpen />);
    view.rerender(<LiquidPopover {...view.props} isOpen={false} />);
    await act(async () => {
      vi.advanceTimersByTime(32);
    });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(cancel).toHaveBeenCalled();
    view.rerender(<LiquidPopover {...view.props} isOpen />);
    await act(async () => {
      vi.advanceTimersByTime(32);
    });
    expect(
      screen
        .getByRole('menuitem', { name: 'Редактировать' })
        .closest('[inert]'),
    ).toBeNull();
  });

  it('reports an external source lifecycle without mutating its visibility', () => {
    const sourceRef = createRef<HTMLDivElement>(),
      presentation = vi.fn();
    const view = render(
      <>
        <div ref={sourceRef} style={{ visibility: 'visible' }} />
        <LiquidPopover
          isOpen
          onOpenChange={() => {}}
          onPresentationChange={presentation}
          trigger={<button>Открыть внешний источник</button>}
          triggerRef={sourceRef}
          items={[{ id: 'action', label: 'Действие' }]}
        />
      </>,
    );

    expect(sourceRef.current?.style.visibility).toBe('visible');
    const trigger = screen
      .getByText('Открыть внешний источник')
      .closest('button');
    expect(trigger?.style.visibility).toBe('hidden');
    expect(presentation).toHaveBeenLastCalledWith(true);

    view.unmount();
    expect(presentation).toHaveBeenLastCalledWith(false);
  });

  it('releases viewport listeners and presentation ownership on unmount', () => {
    const view = setup(),
      remove = vi.spyOn(window, 'removeEventListener');
    view.rerender(<LiquidPopover {...view.props} isOpen />);
    expect(view.presentation).toHaveBeenLastCalledWith(true);
    view.unmount();
    expect(
      remove.mock.calls.some(([event]) => String(event) === 'resize'),
    ).toBe(true);
    expect(view.presentation).toHaveBeenLastCalledWith(false);
  });
});

it('finishes opening and fully reverses the same animation on close', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('CSS', { supports: () => true });
  vi.stubGlobal('CanvasRenderingContext2D', class {});
  vi.stubGlobal('Path2D', class {});
  const context = {
    measureText: () => ({
      width: 8,
      actualBoundingBoxAscent: 12,
      actualBoundingBoxDescent: 3,
    }),
    fillText: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
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
    getImageData: (_x: number, _y: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
    }),
    createImageData: (width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
    }),
    putImageData: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    function (this: HTMLCanvasElement) {
      return {
        ...context,
        canvas: this,
      } as unknown as CanvasRenderingContext2D;
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
    'data:image/png;base64,AA==',
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      const source = this.tagName === 'BUTTON',
        left = source ? 40 : 100,
        top = source ? 40 : 140;
      const width = source ? 44 : 216,
        height = source ? 44 : 112;
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
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
  const view = setup();
  view.rerender(<LiquidPopover {...view.props} isOpen />);
  await act(async () => {
    vi.advanceTimersByTime(32);
  });
  const menu = screen.getByRole('menu'),
    native = screen.getByRole('menuitem', {
      name: 'Редактировать',
    }).parentElement!;
  expect(native.hasAttribute('inert')).toBe(true);
  await act(async () => {
    vi.advanceTimersByTime(1100);
  });
  expect(native.hasAttribute('inert')).toBe(false);
  expect(native.style.filter).toBe('none');
  expect(native.style.opacity).toBe('1');
  expect(menu.querySelector('svg')?.style.display).toBe('none');

  const trigger = screen.getByText('Открыть').closest('button')!;
  expect(trigger.style.visibility).toBe('hidden');
  expect(view.presentation).toHaveBeenLastCalledWith(true);

  fireEvent.click(screen.getByRole('menuitem', { name: 'Редактировать' }));
  expect(view.select).toHaveBeenCalledOnce();
  expect(view.change).toHaveBeenCalledWith(false);

  const replacementItems = [
    { id: 'coach-action', label: 'Действие тренера' },
    { id: 'coach-settings', label: 'Настройки тренера' },
    { id: 'coach-clients', label: 'Клиенты тренера' },
  ];
  view.rerender(
    <LiquidPopover
      {...view.props}
      isOpen={false}
      items={replacementItems}
    />,
  );
  await act(async () => {
    vi.advanceTimersByTime(32);
  });
  expect(screen.getByRole('menu')).toBeTruthy();
  expect(menu.querySelector('canvas')?.style.display).toBe('block');
  expect(native.hasAttribute('inert')).toBe(true);
  expect(trigger.style.visibility).toBe('hidden');
  expect(view.presentation).toHaveBeenLastCalledWith(true);
  expect(
    screen.getByRole('menuitem', { name: 'Редактировать' }),
  ).toBeTruthy();
  expect(
    screen.queryByRole('menuitem', { name: 'Действие тренера' }),
  ).toBeNull();

  await act(async () => {
    vi.advanceTimersByTime(700);
  });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(trigger.style.visibility).toBe('');
  expect(view.presentation).toHaveBeenLastCalledWith(false);
});
