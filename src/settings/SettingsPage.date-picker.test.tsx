// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';

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

describe('SettingsPage DatePicker module', () => {
  it('keeps the real DatePicker mounted in the modules gallery and opens it from the demo trigger', () => {
    render(<SettingsPage onNavigationContextChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Модули' }));

    expect(screen.getByText('Date picker')).toBeTruthy();
    expect(screen.getByText(/Выбранная дата: 2026-09-30/)).toBeTruthy();
    expect(document.querySelector('[aria-label="Выбор даты"]')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Выбрать дату' }));

    const dialog = screen.getByRole('dialog', { name: 'Выбор даты' });
    expect(dialog.getAttribute('data-date-picker-surface')).toBe('top-panel');
    expect(screen.getByRole('button', { name: 'Выбрать год, сейчас 2026' })).toBeTruthy();
  });
});
