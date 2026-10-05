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

describe('SettingsPage TimePicker iOS stand', () => {
  it('opens the forced iOS scale variant from Modules', () => {
    render(<SettingsPage onNavigationContextChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Модули' }));

    fireEvent.click(screen.getByRole('button', { name: 'iOS mode' }));

    expect(screen.getByText(/Lens mode: ios/)).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Выбор времени' })).toBeTruthy();
    expect(document.querySelector('[data-ui-time-picker-lens-mode="ios"]')).not.toBeNull();
  });
});
