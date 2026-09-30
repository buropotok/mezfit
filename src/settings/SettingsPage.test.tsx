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

describe('SettingsPage modules gallery', () => {
  it('opens the modules gallery and exposes real workout modules', () => {
    const onNavigationContextChange = vi.fn();
    render(<SettingsPage onNavigationContextChange={onNavigationContextChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Модули' }));

    expect(screen.getByText('Собранные модули')).toBeTruthy();
    expect(screen.getByText('Карточка упражнения и подходов')).toBeTruthy();
    expect(screen.getByText('Жим штанги лёжа')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Открыть подход 1' })).toBeTruthy();
    expect(onNavigationContextChange).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Модули' }));
  });

  it('mounts the real TimePicker in the modules stand', () => {
    render(<SettingsPage onNavigationContextChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Модули' }));

    expect(screen.getByText('Time picker')).toBeTruthy();
    expect(screen.getByText(/Выбранное время: 08:30/)).toBeTruthy();
    expect(screen.getByText(/Haptic backend: none/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Selection' }));
    expect(screen.getByText(/Probe: telegram-selection → unsupported/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Выбрать время' }));

    expect(screen.getByRole('dialog', { name: 'Выбор времени' })).toBeTruthy();
    expect(screen.getByRole('listbox', { name: 'Часы' })).toBeTruthy();
    expect(screen.getByRole('listbox', { name: 'Минуты' })).toBeTruthy();
  });
});
