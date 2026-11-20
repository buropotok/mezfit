// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';
import type { NavigationContext } from '../NavigationShell';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  localStorage.clear();
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

it('defaults chat media backup to off and persists changes when reopening settings', () => {
  const label = 'Копировать медиа из чатов в резервное облако';
  const page = render(<SettingsPage activeRole="coach" onNavigationContextChange={vi.fn()} />);
  const toggle = screen.getByRole('checkbox', { name: label });
  expect(toggle).toHaveProperty('checked', false);
  fireEvent.click(toggle);
  expect(toggle).toHaveProperty('checked', true);
  page.unmount();

  const reopened = render(<SettingsPage activeRole="client" onNavigationContextChange={vi.fn()} />);
  const persisted = screen.getByRole('checkbox', { name: label });
  expect(persisted).toHaveProperty('checked', true);
  fireEvent.click(persisted);
  reopened.unmount();

  render(<SettingsPage activeRole="client" onNavigationContextChange={vi.fn()} />);
  expect(screen.getByRole('checkbox', { name: label })).toHaveProperty('checked', false);
});
