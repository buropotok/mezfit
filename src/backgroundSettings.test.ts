// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BACKGROUND_SETTINGS,
  applyBackgroundSettings,
  loadBackgroundSettings,
  normalizeBackgroundSettings,
  saveBackgroundSettings,
} from './backgroundSettings';

describe('background settings', () => {
  it('defaults to black, validates stored HSV and rejects invalid values', () => {
    const storage = { getItem: vi.fn().mockReturnValue(null) };
    expect(loadBackgroundSettings(storage)).toEqual(DEFAULT_BACKGROUND_SETTINGS);
    storage.getItem.mockReturnValue('{"hue":219,"saturation":56,"value":43}');
    expect(loadBackgroundSettings(storage)).toEqual({ hue: 219, saturation: 56, value: 43 });
    storage.getItem.mockReturnValue('{"hue":120,"saturation":120,"value":70}');
    expect(loadBackgroundSettings(storage)).toEqual(DEFAULT_BACKGROUND_SETTINGS);
    storage.getItem.mockReturnValue('{broken');
    expect(loadBackgroundSettings(storage)).toEqual(DEFAULT_BACKGROUND_SETTINGS);
  });

  it('persists a normalized color without requiring network access', () => {
    const storage = { setItem: vi.fn() };
    saveBackgroundSettings(storage, { hue: 250, saturation: 80, value: 40 });
    expect(storage.setItem).toHaveBeenCalledWith(
      'mezfit.backgroundSettings.v1',
      '{"hue":250,"saturation":80,"value":40}',
    );
    expect(normalizeBackgroundSettings({ hue: Infinity, saturation: 50, value: 50 }))
      .toEqual(DEFAULT_BACKGROUND_SETTINGS);
  });

  it('applies the selected color as the app background token', () => {
    const target = { setProperty: vi.fn() };
    applyBackgroundSettings({ hue: 219, saturation: 56, value: 43 }, target);
    expect(target.setProperty).toHaveBeenCalledWith('--app-background-color', '#30466E');
    applyBackgroundSettings({ ...DEFAULT_BACKGROUND_SETTINGS }, target);
    expect(target.setProperty).toHaveBeenLastCalledWith('--app-background-color', '#000000');
  });
});
