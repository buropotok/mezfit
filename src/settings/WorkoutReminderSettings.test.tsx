// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkoutReminderSettings } from './WorkoutReminderSettings';
import { SettingsPage } from './SettingsPage';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('role-specific reminder controls', () => {
  it('exposes exactly the athlete reminder in Client mode', () => {
    render(<WorkoutReminderSettings role="client" />);
    expect(screen.getByText('Напоминания о тренировках')).toBeTruthy();
    expect(screen.queryByText('Тренировки с клиентами')).toBeNull();
    expect(screen.queryByText('Мои самостоятельные тренировки')).toBeNull();
  });

  it('integrates the correct reminder section into the Coach settings root', () => {
    render(<SettingsPage activeRole="coach" onNavigationContextChange={vi.fn()} />);
    expect(screen.getByText('Тренировки с клиентами')).toBeTruthy();
    expect(screen.getByText('Мои самостоятельные тренировки')).toBeTruthy();
    expect(screen.queryByText('Напоминания о тренировках')).toBeNull();
  });

  it('exposes two independent controls in Coach mode', () => {
    render(<WorkoutReminderSettings role="coach" />);
    expect(screen.getByText('Тренировки с клиентами')).toBeTruthy();
    expect(screen.getByText('Мои самостоятельные тренировки')).toBeTruthy();
    expect(screen.queryByText('Напоминания о тренировках')).toBeNull();
    const toggles = screen.getAllByRole('checkbox');
    expect(toggles).toHaveLength(2);
    // Inaccessible personal storage must not allow a speculative settings edit.
    expect(toggles.every(toggle => (toggle as HTMLInputElement).disabled)).toBe(true);
    expect(screen.getByRole('link', { name: 'откройте бота' }).getAttribute('href'))
      .toBe('https://t.me/mezfit_bot?start=workout_reminders');
  });
});
