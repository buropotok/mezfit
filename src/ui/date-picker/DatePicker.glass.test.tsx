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
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DatePicker glass material', () => {
  it('uses ModalTuned on the floating panel and year popover', () => {
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
    const pickerGlass = pickerDialog.querySelector<HTMLElement>('.ui-glass-surface');

    expect(pickerGlass).toBeTruthy();
    expect(pickerGlass?.style.getPropertyValue('--ui-glass-surface-tint-a')).toBe('0.27');
    expect(pickerGlass?.style.getPropertyValue('--ui-glass-surface-blur')).toBe('2px');

    fireEvent.click(screen.getByRole('button', { name: 'Выбрать год, сейчас 2026' }));

    const yearDialog = screen.getByRole('dialog', { name: 'Выберите год' });
    const yearGlass = yearDialog.querySelector<HTMLElement>('.ui-glass-surface');

    expect(yearGlass).toBeTruthy();
    expect(yearGlass?.style.getPropertyValue('--ui-glass-surface-tint-a')).toBe('0.27');
    expect(yearGlass?.style.getPropertyValue('--ui-glass-surface-blur')).toBe('2px');
  });
});
