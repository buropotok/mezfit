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
