/** @vitest-environment jsdom */
import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { KonstaProvider, Searchbar as KonstaSearchbar } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MezfitSearchbar } from './Searchbar';

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

function renderSearchbar(props: ComponentProps<typeof MezfitSearchbar>) {
  return render(
    <KonstaProvider theme="ios" dark>
      <MezfitSearchbar {...props} />
    </KonstaProvider>,
  );
}

describe('MezfitSearchbar', () => {
  it('keeps Konsta Searchbar layout classes while replacing its Glass renderer', () => {
    const konsta = render(
      <KonstaProvider theme="ios" dark>
        <KonstaSearchbar value="bench" placeholder="Поиск" disableButton />
      </KonstaProvider>,
    );
    const mezfit = renderSearchbar({
      value: 'bench',
      placeholder: 'Поиск',
      disableButton: true,
    });

    const konstaRoot = konsta.container.querySelector<HTMLElement>('.k-searchbar');
    const mezfitRoot = mezfit.container.querySelector<HTMLElement>('.k-searchbar');
    const konstaInput = konsta.container.querySelector<HTMLInputElement>('input[placeholder="Поиск"]');
    const mezfitInput = mezfit.container.querySelector<HTMLInputElement>('input[placeholder="Поиск"]');
    const konstaClear = konsta.container.querySelector<HTMLButtonElement>('button');
    const mezfitClear = mezfit.container.querySelector<HTMLButtonElement>('button');

    expect(mezfitRoot?.className).toBe(konstaRoot?.className);
    expect(konstaInput).not.toBeNull();
    expect(mezfitInput).not.toBeNull();
    expect(mezfitInput?.className).toBe(konstaInput?.className);
    expect(mezfitClear?.className).toBe(konstaClear?.className);
    expect(mezfit.container.querySelector('.ui-glass-surface')).not.toBeNull();
  });

  it('preserves Konsta Searchbar input, clear, focus, and disable behavior', () => {
    const onClear = vi.fn();
    const onDisable = vi.fn();
    const view = renderSearchbar({
      value: 'bench',
      placeholder: 'Поиск',
      disableButton: true,
      onClear,
      onDisable,
    });

    const root = view.container.querySelector<HTMLElement>('.k-searchbar');
    const input = view.getByPlaceholderText('Поиск') as HTMLInputElement;
    const buttons = view.container.querySelectorAll<HTMLButtonElement>('button');
    const glassSurfaces = view.container.querySelectorAll<HTMLElement>('.ui-glass-surface');

    expect(root).not.toBeNull();
    expect(input.name).toBe('search');
    expect(input.type).toBe('text');
    expect(glassSurfaces).toHaveLength(2);
    expect(buttons).toHaveLength(2);

    const clearButton = buttons[0];
    const disableButton = buttons[1];
    expect(disableButton.style.marginRight).toBe('-64px');
    expect(disableButton.style.marginLeft).toBe('0px');

    fireEvent.click(clearButton);
    expect(onClear).toHaveBeenCalledTimes(1);

    fireEvent.focus(input);
    expect(disableButton.style.marginRight).toBe('0px');
    expect(disableButton.style.marginLeft).toBe('16px');

    fireEvent.click(disableButton);
    expect(onDisable).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(2);
  });

  it('uses the requested GlassSurface preset for the Searchbar substrate', () => {
    const view = renderSearchbar({
      value: '',
      glassPreset: 'blue',
      glassOptics: false,
    });

    const glass = view.container.querySelector<HTMLElement>('.ui-glass-surface');
    expect(glass).not.toBeNull();
    expect(glass?.style.getPropertyValue('--ui-glass-surface-tint-r')).toBe('10');
    expect(glass?.style.getPropertyValue('--ui-glass-surface-tint-g')).toBe('74');
    expect(glass?.style.getPropertyValue('--ui-glass-surface-tint-b')).toBe('138');
  });

  it('forwards application glass optics to every replacement GlassSurface', async () => {
    const view = renderSearchbar({
      value: '',
      disableButton: true,
      glassPreset: 'blue',
      glassOptics: true,
    });

    const glassSurfaces = view.container.querySelectorAll<HTMLElement>('.ui-glass-surface');
    expect(glassSurfaces).toHaveLength(2);
    glassSurfaces.forEach((glass) => {
      expect(glass.style.getPropertyValue('--ui-glass-surface-tint-r')).toBe('10');
      expect(glass.style.getPropertyValue('--ui-glass-surface-tint-g')).toBe('74');
      expect(glass.style.getPropertyValue('--ui-glass-surface-tint-b')).toBe('138');
    });
    await waitFor(() => {
      expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledTimes(2);
    });
  });
});
