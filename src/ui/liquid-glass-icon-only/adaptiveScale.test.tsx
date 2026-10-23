/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiquidGlassIconOnly } from '../LiquidGlassIconOnly';
import { liquidTabScale, LIQUID_TAB_BASE_HEIGHT } from './adaptiveScale';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('adaptive icon-only liquid tab', () => {
  it('interpolates between 44px at 320 and 64px at 406, clamped outside those widths', () => {
    expect(liquidTabScale(320) * LIQUID_TAB_BASE_HEIGHT).toBe(44);
    expect(liquidTabScale(406) * LIQUID_TAB_BASE_HEIGHT).toBe(64);
    expect(liquidTabScale(363) * LIQUID_TAB_BASE_HEIGHT).toBe(54);
    expect(liquidTabScale(280) * LIQUID_TAB_BASE_HEIGHT).toBe(44);
    expect(liquidTabScale(600) * LIQUID_TAB_BASE_HEIGHT).toBe(64);
    expect(liquidTabScale(0)).toBe(1);
    expect(liquidTabScale(Number.NaN)).toBe(1);
  });

  it('scales the presentation uniformly and compensates its width without changing the scene', () => {
    const props = {
      tabs: [],
      value: null,
      hidden: false,
      onValueChange: vi.fn(),
    };
    const view = render(<LiquidGlassIconOnly {...props} scale={liquidTabScale(320)} />);
    const root = view.container.firstElementChild as HTMLElement;
    expect(root.style.transform).toBe('scale(0.6875)');
    expect(Number.parseFloat(root.style.width)).toBeCloseTo(100 / 0.6875);
    expect(root.style.height).toBe('64px');

    view.rerender(<LiquidGlassIconOnly {...props} scale={1} />);
    expect(root.style.transform).toBe('');
    expect(root.style.width).toBe('100%');
  });
});
