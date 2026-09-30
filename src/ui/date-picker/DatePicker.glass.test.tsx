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

describe('DatePicker Konsta baseline', () => {
  it('uses the original Konsta Panel and Popover materials without Mezfit GlassSurface wrappers', () => {
    render(
      <KonstaProvider theme="ios" dark>
        <div className="k-ios dark">
          <DatePicker
            opened
            value="2026-09-25"
            onChange={() => {}}
            onClose={() => {}}
          />
        </div>
      </KonstaProvider>,
    );

    const pickerDialog = screen.getByRole('dialog', { name: 'Выбор даты' });
    expect(pickerDialog.classList.contains('ui-glass-surface')).toBe(false);
    expect(pickerDialog.querySelector('.ui-glass-surface')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Выбрать год, сейчас 2026' }));

    const yearDialog = screen.getByRole('dialog', { name: 'Выберите год' });
    expect(yearDialog.querySelector('.ui-glass-surface')).toBeNull();
  });
});
