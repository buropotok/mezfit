// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultTypographySettings } from '../typographySettings';
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

describe('SettingsPage typography settings', () => {
  it('opens the fonts screen with all six semantic presets', () => {
    const onNavigationContextChange = vi.fn();

    render(<SettingsPage onNavigationContextChange={onNavigationContextChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Шрифты' }));

    expect(screen.getByRole('region', { name: 'Шрифты' })).toBeTruthy();
    for (const label of ['Large title', 'Title', 'Headline', 'Body', 'Footnote', 'Caption']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getAllByLabelText('Размер, px')).toHaveLength(6);
    expect(onNavigationContextChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Шрифты' }),
    );
  });

  it('emits size, weight and font-style changes for a semantic preset', () => {
    const onTypographySettingsChange = vi.fn();
    const settings = defaultTypographySettings();

    const view = render(
      <SettingsPage
        typographySettings={settings}
        onTypographySettingsChange={onTypographySettingsChange}
        onNavigationContextChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Шрифты' }));

    const firstPreset = view.container.querySelector<HTMLElement>('.settings-page__typography-preset');
    expect(firstPreset).not.toBeNull();

    fireEvent.change(within(firstPreset as HTMLElement).getByLabelText('Размер, px'), {
      target: { value: '26' },
    });
    expect(onTypographySettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        'large-title': expect.objectContaining({ size: 26 }),
      }),
    );

    fireEvent.click(within(firstPreset as HTMLElement).getByRole('button', { name: '500' }));
    fireEvent.click(screen.getByText('600'));
    expect(onTypographySettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        'large-title': expect.objectContaining({ weight: 600 }),
      }),
    );

    fireEvent.click(within(firstPreset as HTMLElement).getByRole('button', { name: 'Обычное' }));
    fireEvent.click(screen.getByText('Курсив'));
    expect(onTypographySettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        'large-title': expect.objectContaining({ fontStyle: 'italic' }),
      }),
    );
  });

  it('resets all presets to product defaults', () => {
    const onTypographySettingsChange = vi.fn();
    const settings = defaultTypographySettings();
    settings.body.size = 18;

    render(
      <SettingsPage
        typographySettings={settings}
        onTypographySettingsChange={onTypographySettingsChange}
        onNavigationContextChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Шрифты' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить шрифты' }));

    expect(onTypographySettingsChange).toHaveBeenLastCalledWith(defaultTypographySettings());
  });
});
