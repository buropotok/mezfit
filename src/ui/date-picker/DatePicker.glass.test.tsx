// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatePicker } from './DatePicker';

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DatePicker Mezfit overlay materials', () => {
  it('keeps GlassSurface materials for the panel mode and year LiquidPopover', () => {
    render(
      <KonstaProvider theme="ios" dark>
        <div className="k-ios dark">
          <DatePicker
            opened
            surface="panel"
            value="2026-09-25"
            onChange={() => {}}
            onClose={() => {}}
          />
        </div>
      </KonstaProvider>,
    );

    const pickerDialog = screen.getByRole('dialog', { name: 'Выбор даты' });
    expect(pickerDialog.classList.contains('ui-glass-surface')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Выбрать год, сейчас 2026' }));

    const yearDialog = screen.getByRole('dialog', { name: 'Выберите год' });
    expect(yearDialog.classList.contains('ui-liquid-popover')).toBe(true);
    expect(yearDialog.querySelector('.ui-liquid-popover__glass.ui-glass-surface')).not.toBeNull();
  });
});
