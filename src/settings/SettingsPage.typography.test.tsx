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
  it('opens the fonts screen with all seven semantic presets', () => {
    const onNavigationContextChange = vi.fn();

    render(<SettingsPage onNavigationContextChange={onNavigationContextChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Шрифты' }));

    expect(screen.getByRole('region', { name: 'Шрифты' })).toBeTruthy();
    for (const label of ['Large title', 'Title', 'Headline', 'Chat', 'Body', 'Footnote', 'Caption']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getAllByLabelText('Размер, px')).toHaveLength(7);
    expect(onNavigationContextChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Шрифты' }),
    );
  });

  it('offers the app-wide Inter font alongside the original default and resets the choice', () => {
    const onFontFamilyChange = vi.fn();
    render(
      <SettingsPage
        fontFamily="zen-maru-gothic"
        onFontFamilyChange={onFontFamilyChange}
        onNavigationContextChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Шрифты' }));

    const selector = screen.getByRole('button', { name: 'Семейство шрифта' });
    expect(selector.textContent).toBe('Zen Maru Gothic');
    fireEvent.click(selector);
    fireEvent.click(screen.getByRole('button', { name: 'Inter' }));
    expect(onFontFamilyChange).toHaveBeenLastCalledWith('inter');

    fireEvent.click(screen.getByRole('button', { name: 'Сбросить шрифты' }));
    expect(onFontFamilyChange).toHaveBeenLastCalledWith('zen-maru-gothic');
  });

  it('keeps incomplete numeric drafts editable until they become valid', () => {
    const onTypographySettingsChange = vi.fn();
    const view = render(
      <SettingsPage
        typographySettings={defaultTypographySettings()}
        onTypographySettingsChange={onTypographySettingsChange}
        onNavigationContextChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Шрифты' }));

    const firstPreset = view.container.querySelector<HTMLElement>('.settings-page__typography-preset');
    const sizeInput = within(firstPreset as HTMLElement).getByLabelText('Размер, px') as HTMLInputElement;

    fireEvent.change(sizeInput, { target: { value: '3' } });
    expect(sizeInput.value).toBe('3');
    expect(onTypographySettingsChange).not.toHaveBeenCalled();

    fireEvent.change(sizeInput, { target: { value: '30' } });
    expect(onTypographySettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        'large-title': expect.objectContaining({ size: 30 }),
      }),
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

  it('lets Chat change independently of Headline through the existing fonts controls', () => {
    const onTypographySettingsChange = vi.fn();
    const initial = defaultTypographySettings();
    const view = render(<SettingsPage
      typographySettings={initial}
      onTypographySettingsChange={onTypographySettingsChange}
      onNavigationContextChange={vi.fn()}
    />);
    fireEvent.click(screen.getByRole('button', { name: 'Шрифты' }));
    const roleCard = screen.getByText('Chat').closest('.settings-page__typography-preset');
    expect(roleCard).not.toBeNull();
    const sizeInput = within(roleCard as HTMLElement).getByLabelText('Размер, px');
    fireEvent.change(sizeInput, { target: { value: '20' } });
    expect(onTypographySettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        chat: expect.objectContaining({ size: 20, lineHeight: 22 }),
        headline: expect.objectContaining({ size: 17, lineHeight: 22 }),
      }),
    );
    expect(view.container.querySelector('.ui-text--chat')).not.toBeNull();
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
