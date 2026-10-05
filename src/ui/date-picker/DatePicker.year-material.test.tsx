/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatePicker } from './DatePicker';

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
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DatePicker year material', () => {
  it('uses the same preset for the year trigger and LiquidPopover surface', () => {
    render(
      <KonstaProvider theme="ios" dark>
        <div className="k-ios dark">
          <DatePicker
            opened
            value="2026-09-25"
            onChange={() => {}}
            onClose={() => {}}
            glassPreset="smoked"
            glassOptics
          />
        </div>
      </KonstaProvider>,
    );

    const trigger = screen.getByRole('button', { name: 'Выбрать год, сейчас 2026' });
    const triggerSurface = trigger.closest('.ui-glass-surface') as HTMLElement | null;
    expect(triggerSurface).toBeTruthy();
    expect(triggerSurface?.style.getPropertyValue('--ui-glass-surface-tint-a')).toBe('0.36');

    trigger.click();

    const popover = screen.getByRole('dialog', { name: 'Выберите год' });
    const popoverSurface = popover.querySelector<HTMLElement>('.ui-liquid-popover__glass');
    expect(popoverSurface).toBeTruthy();
    expect(popoverSurface?.style.getPropertyValue('--ui-glass-surface-tint-a')).toBe('0.36');
  });
});
