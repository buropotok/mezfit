// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NavigationContext } from '../NavigationShell';
import { SettingsPage } from './SettingsPage';

vi.mock('./ResistanceBandsSettings', () => ({
  ResistanceBandsSettings: () => <section aria-label="Настройки фитнес-лент">Ленты подключены</section>,
}));

afterEach(() => { cleanup(); });

describe('SettingsPage personal bands navigation', () => {
  it('opens the real band editor from Settings and returns through the app Back context', () => {
    const onNavigationContextChange = vi.fn<(context: NavigationContext | null) => void>();
    render(<SettingsPage onNavigationContextChange={onNavigationContextChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Фитнес-ленты' }));
    expect(screen.getByRole('region', { name: 'Настройки фитнес-лент' })).toBeTruthy();
    const context = onNavigationContextChange.mock.lastCall?.[0];
    expect(context?.title).toBe('Фитнес-ленты');
    expect(context?.scrollKey).toBe('settings:resistance-bands');
    context?.onBack?.();
    expect(screen.getByRole('button', { name: 'Фитнес-ленты' })).toBeTruthy();
  });
});
