// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setDiscussionMediaBackupEnabled } from '../media/discussionMediaBackupPreference';
import { SettingsPage } from './SettingsPage';
import type { NavigationContext } from '../NavigationShell';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('opens the storage reset section in both modes and returns through navigation context', () => {
  const navigation = vi.fn<(context: NavigationContext | null) => void>();
  render(<SettingsPage activeRole="coach" onNavigationContextChange={navigation} />);
  fireEvent.click(screen.getByRole('button', { name: 'Очистка данных' }));
  expect(screen.getByRole('region', { name: 'Очистка данных' })).toBeTruthy();
  const context = navigation.mock.lastCall?.[0];
  expect(context).toEqual(expect.objectContaining({ title: 'Очистка данных', scrollKey: 'settings:data-reset' }));
  act(() => context?.onBack?.());
  expect(screen.getByRole('region', { name: 'Настройки' })).toBeTruthy();
});

it('persists the chat media backup toggle when reopening settings', () => {
  const label = 'Копировать медиа из чатов в резервное облако';
  try {
    const page = render(<SettingsPage activeRole="coach" onNavigationContextChange={vi.fn()} />);
    const toggle = screen.getByRole('checkbox', { name: label });
    expect(toggle).toHaveProperty('checked', true);
    fireEvent.click(toggle);
    expect(toggle).toHaveProperty('checked', false);
    page.unmount();

    render(<SettingsPage activeRole="client" onNavigationContextChange={vi.fn()} />);
    const reopened = screen.getByRole('checkbox', { name: label });
    expect(reopened).toHaveProperty('checked', false);
    fireEvent.click(reopened);
    expect(reopened).toHaveProperty('checked', true);
  } finally {
    setDiscussionMediaBackupEnabled(true);
  }
});
