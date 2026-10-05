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

describe('DatePicker bare surface', () => {
  it('uses the bare sliding calendar surface by default', () => {
    const onClose = vi.fn();

    const view = render(
      <KonstaProvider theme="ios" dark>
        <div className="k-ios dark">
          <DatePicker
            opened
            value="2026-09-25"
            onChange={() => {}}
            onClose={onClose}
          />
        </div>
      </KonstaProvider>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Выбор даты' });
    expect(dialog.getAttribute('data-date-picker-surface')).toBe('bare');
    expect(dialog.classList.contains('ui-glass-surface')).toBe(false);

    const backdrop = view.container.querySelector<HTMLElement>('.ui-date-picker__bare-backdrop--opened');
    expect(backdrop).toBeTruthy();

    fireEvent.click(backdrop as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
