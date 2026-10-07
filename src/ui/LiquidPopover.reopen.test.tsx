/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from '@testing-library/react';
import { createRef, type ReactNode, type Ref } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { LiquidPopover } from './LiquidPopover';

const placement = vi.hoisted(() => ({ notify: null as (() => void) | null }));

// Hold placement at the public boundary so the browser could paint waiting UI.
vi.mock('./konsta-mezfit/Popover', () => ({
  MezfitPopover: ({ opened, children, ref, onPositioned }: {
    opened: boolean;
    children: ReactNode;
    ref: Ref<HTMLDivElement>;
    onPositioned: (element: HTMLElement) => void;
  }) => {
    placement.notify = () => onPositioned(document.createElement('div'));
    return <div ref={ref} role="menu" hidden={!opened}>{children}</div>;
  },
}));

vi.mock('./GlassSurface', () => ({
  GlassSurface: ({ ref, className }: { ref: Ref<HTMLDivElement>; className: string }) =>
    <div ref={ref} className={className} data-testid="glass" />,
}));

afterEach(() => {
  cleanup();
  placement.notify = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('hides the previous HTML handoff until the reopened menu is positioned', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('CanvasRenderingContext2D', undefined);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(0), 16),
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  const triggerRef = createRef<HTMLButtonElement>();
  const props = {
    triggerRef,
    trigger: <button ref={triggerRef}>Open</button>,
    items: [{ id: 'action', label: 'Action' }],
    onOpenChange: vi.fn(),
  };
  const view = render(<LiquidPopover {...props} isOpen />);
  const native = screen.getByRole('menuitem').parentElement!;
  const glass = screen.getByTestId('glass');
  const canvas = screen.getByRole('menu').querySelector('canvas')!;
  expect(native.style.opacity).toBe('0');
  act(() => placement.notify?.());
  await act(async () => { vi.advanceTimersByTime(32); });
  expect(native.style.opacity).toBe('1');
  expect(glass.style.opacity).toBe('1');

  view.rerender(<LiquidPopover {...props} isOpen={false} />);
  await act(async () => { vi.advanceTimersByTime(32); });
  expect(native.style.opacity).toBe('0');
  expect(glass.style.opacity).toBe('0');
  view.rerender(<LiquidPopover {...props} isOpen />);
  await act(async () => { vi.advanceTimersByTime(64); });
  expect(native.style.opacity).toBe('0');
  expect(glass.style.opacity).toBe('0');
  expect(canvas.style.opacity).toBe('0');
  expect(native.hasAttribute('inert')).toBe(true);

  act(() => placement.notify?.());
  await act(async () => { vi.advanceTimersByTime(32); });
  expect(native.style.opacity).toBe('1');
  expect(native.hasAttribute('inert')).toBe(false);
});
