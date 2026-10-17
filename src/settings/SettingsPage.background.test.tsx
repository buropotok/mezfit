// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlassSurfaceProvider } from '../ui';
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

describe('SettingsPage background preference', () => {
  it('shows the shared color wheel, exposes the schedule exception and resets to black', () => {
    const onBackgroundSettingsChange = vi.fn();
    const onNavigationContextChange = vi.fn();
    render(
      <SettingsPage
        backgroundSettings={{ hue: 219, saturation: 56, value: 43 }}
        onBackgroundSettingsChange={onBackgroundSettingsChange}
        onNavigationContextChange={onNavigationContextChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Цвет фона' }));
    expect(screen.getByRole('region', { name: 'Цвет фона' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Выбрать цвет фона/ })).toBeTruthy();
    expect(screen.getByText(/кроме расписания/)).toBeTruthy();
    expect(screen.getByText('#30466E')).toBeTruthy();
    expect(onNavigationContextChange).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Цвет фона' }));

    fireEvent.click(screen.getByRole('button', { name: 'Вернуть стандартный фон' }));
    expect(onBackgroundSettingsChange).toHaveBeenLastCalledWith({ hue: 0, saturation: 0, value: 0 });
  });

  it('makes wheel selection visible from the default black background and supports brightness', () => {
    const onBackgroundSettingsChange = vi.fn();
    render(
      <SettingsPage
        backgroundSettings={{ hue: 0, saturation: 0, value: 0 }}
        onBackgroundSettingsChange={onBackgroundSettingsChange}
        onNavigationContextChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Цвет фона' }));

    fireEvent.pointerDown(screen.getByRole('button', { name: /Выбрать цвет фона/ }), {
      pointerId: 1, clientX: 90, clientY: 10,
    });
    expect(onBackgroundSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ value: 43, saturation: 100 }),
    );

    fireEvent.change(screen.getByRole('slider', { name: /Яркость/ }), { target: { value: '65' } });
    expect(onBackgroundSettingsChange).toHaveBeenLastCalledWith({ hue: 0, saturation: 0, value: 65 });
  });

  it('uses modalTuned optics-off panels with the current global blur', () => {
    const view = render(
      <GlassSurfaceProvider blur={7} optics>
        <SettingsPage
          glassSettings={{ preset: 'blue', optics: true, blur: 18 }}
          onNavigationContextChange={vi.fn()}
        />
      </GlassSurfaceProvider>,
    );
    const panels = Array.from(view.container.querySelectorAll<HTMLElement>('.settings-page__section'));
    expect(panels).toHaveLength(2);
    for (const panel of panels) {
      expect(panel.classList.contains('ui-glass-surface')).toBe(true);
      expect(panel.getAttribute('data-ui-glass-map-ready')).toBe('false');
      expect(panel.style.getPropertyValue('--ui-glass-surface-blur')).toBe('18px');
    }
    fireEvent.click(screen.getByRole('button', { name: 'Шрифты' }));
    const typographyPanel = view.container.querySelector<HTMLElement>('.settings-page__section');
    expect(typographyPanel?.style.getPropertyValue('--ui-glass-surface-blur')).toBe('18px');
  });
});
