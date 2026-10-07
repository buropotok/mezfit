// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SettingsPage MezfitTopPanel module', () => {
  it('exposes the standalone top panel in the Modules gallery', () => {
    render(<SettingsPage onNavigationContextChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Модули' }));

    expect(screen.getByText('Mezfit top panel', { selector: '#module-top-panel-title' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Открыть Top Panel' }));

    const dialog = screen.getByRole('dialog', { name: 'Mezfit Top Panel demo' });
    expect(dialog.getAttribute('data-material')).toBe('default');

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByRole('dialog', { name: 'Mezfit Top Panel demo' })).toBeNull();
  });
});
