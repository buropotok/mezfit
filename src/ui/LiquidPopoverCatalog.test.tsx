/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LiquidPopoverCatalog } from './LiquidPopoverCatalog';
import { resolveLiquidPopoverRenderMode } from './liquidPopoverRenderMode';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('exposes independently testable Auto, SVG and Canvas modes in the UI Kit catalog', () => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  render(
    <KonstaProvider theme="ios" dark>
      <LiquidPopoverCatalog />
    </KonstaProvider>,
  );

  const mode = resolveLiquidPopoverRenderMode('auto');
  expect(screen.getByText('Сравнение режимов')).toBeTruthy();
  for (const label of ['Auto', 'SVG', 'Canvas']) {
    expect(screen.getByRole('button', { name: `Открыть Liquid Popover ${label}` })).toBeTruthy();
  }

  for (const [label, expected] of [
    ['Auto', mode],
    ['SVG', 'svg'],
    ['Canvas', 'canvas'],
  ] as const) {
    fireEvent.click(screen.getByRole('button', { name: `Открыть Liquid Popover ${label}` }));
    const menu = screen.getByRole('menu', { name: `Liquid Popover ${label}` });
    const clipPath = menu.querySelector('canvas')?.style.clipPath;
    if (expected === 'canvas') expect(clipPath).toBe('none');
    else expect(clipPath).toMatch(/^url\(/);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Редактировать' }));
    expect(screen.getByText(`${label}: Редактировать`)).toBeTruthy();
  }
});
