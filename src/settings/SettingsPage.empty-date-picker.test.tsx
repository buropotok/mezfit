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

describe('SettingsPage empty DatePicker control', () => {
  it('opens an empty MezfitSidePanel beside the real DatePicker demo', () => {
    render(<SettingsPage onNavigationContextChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Модули' }));

    expect(screen.getByRole('button', { name: 'Выбрать дату' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Открыть пустой' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Открыть пустой' }));

    expect(screen.getByRole('dialog', { name: 'Пустой Date picker' })).toBeTruthy();
    expect(document.querySelector('[data-month-index]')).toBeNull();
  });
});
