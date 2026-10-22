// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';
import type { NavigationContext } from '../NavigationShell';

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

describe('SettingsPage screen diagnostics', () => {
  it('places diagnostics on its own first surface and returns to settings via Back', () => {
    const onNavigationContextChange = vi.fn<(context: NavigationContext | null) => void>();
    const view = render(<SettingsPage onNavigationContextChange={onNavigationContextChange} />);

    const surface = view.container.querySelector('.settings-page__diagnostics-entry');
    expect(surface).toBeTruthy();
    expect(view.container.querySelectorAll('.settings-page__section')).toHaveLength(2);
    expect(surface?.querySelector('button')?.textContent).toBe('Открыть диагностику');

    fireEvent.click(screen.getByRole('button', { name: 'Открыть диагностику' }));
    expect(screen.getByRole('region', { name: 'Диагностика экрана' })).toBeTruthy();

    const context = onNavigationContextChange.mock.lastCall?.[0];
    expect(context).toEqual(expect.objectContaining({
      title: 'Диагностика экрана',
      scrollKey: 'settings:diagnostics',
    }));

    act(() => context?.onBack?.());
    expect(screen.getByRole('region', { name: 'Настройки' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Открыть диагностику' })).toBeTruthy();
  });

  it('opens directly from a Telegram start parameter and consumes it only once', () => {
    const consumed = vi.fn();
    const view = render(
      <SettingsPage
        onNavigationContextChange={vi.fn()}
        initialScreenDiagnosticsOpen
        onScreenDiagnosticsDeepLinkConsumed={consumed}
      />,
    );

    expect(screen.getByRole('region', { name: 'Диагностика экрана' })).toBeTruthy();
    expect(consumed).toHaveBeenCalledOnce();

    view.rerender(
      <SettingsPage onNavigationContextChange={vi.fn()} initialScreenDiagnosticsOpen={false} />,
    );
    expect(screen.getByRole('region', { name: 'Диагностика экрана' })).toBeTruthy();
  });
});
