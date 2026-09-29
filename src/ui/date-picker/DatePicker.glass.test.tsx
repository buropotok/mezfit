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
  it('replaces the Konsta Panel and Popover glass material without nesting another surface', () => {
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

    expect(pickerDialog.classList.contains('ui-glass-surface')).toBe(true);
    expect(pickerDialog.querySelector('.ui-glass-surface')).toBeNull();
    expect(pickerDialog.style.getPropertyValue('--ui-glass-surface-tint-a')).toBe('0.27');
    expect(pickerDialog.style.getPropertyValue('--ui-glass-surface-blur')).toBe('2px');

    fireEvent.click(screen.getByRole('button', { name: 'Выбрать год, сейчас 2026' }));

    const yearDialog = screen.getByRole('dialog', { name: 'Выберите год' });
    const yearSurfaces = yearDialog.querySelectorAll<HTMLElement>('.ui-glass-surface');

    expect(yearSurfaces).toHaveLength(1);
    expect(yearSurfaces[0]?.style.getPropertyValue('--ui-glass-surface-tint-a')).toBe('0.27');
    expect(yearSurfaces[0]?.style.getPropertyValue('--ui-glass-surface-blur')).toBe('2px');
  });
});
