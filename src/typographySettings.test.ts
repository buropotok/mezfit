import { describe, expect, it, vi } from 'vitest';
import {
  applyTypographySettings,
  defaultTypographySettings,
  loadTypographySettings,
  saveTypographySettings,
} from './typographySettings';

describe('typography settings', () => {
  it('provides the product typography defaults', () => {
    const settings = defaultTypographySettings();

    expect(settings['large-title']).toEqual({
      size: 24,
      weight: 500,
      fontStyle: 'normal',
      lineHeight: 24,
      letterSpacing: 0,
    });
    expect(settings.headline.weight).toBe(400);
    expect(settings.body.size).toBe(15);
  });

  it('persists settings and restores them after reload', () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value); },
    };
    const settings = defaultTypographySettings();
    settings.headline = {
      size: 19,
      weight: 600,
      fontStyle: 'italic',
      lineHeight: 25,
      letterSpacing: 0.75,
    };

    saveTypographySettings(storage, settings);

    expect(loadTypographySettings(storage).headline).toEqual(settings.headline);
  });

  it('falls back per field when stored settings contain invalid values', () => {
    const storage = {
      getItem: () => JSON.stringify({
        headline: {
          size: 999,
          weight: 123,
          fontStyle: 'oblique',
          lineHeight: 24,
          letterSpacing: 0.8,
        },
      }),
    };

    expect(loadTypographySettings(storage).headline).toEqual({
      size: 17,
      weight: 400,
      fontStyle: 'normal',
      lineHeight: 24,
      letterSpacing: 0.8,
    });
  });

  it('applies every preset value to the shared CSS custom properties', () => {
    const settings = defaultTypographySettings();
    settings.headline = {
      size: 19,
      weight: 600,
      fontStyle: 'italic',
      lineHeight: 25,
      letterSpacing: 0.75,
    };
    const setProperty = vi.fn();

    applyTypographySettings(settings, { setProperty });

    expect(setProperty).toHaveBeenCalledWith('--ui-font-size-headline', '19px');
    expect(setProperty).toHaveBeenCalledWith('--ui-line-height-headline', '25px');
    expect(setProperty).toHaveBeenCalledWith('--ui-letter-spacing-headline', '0.75px');
    expect(setProperty).toHaveBeenCalledWith('--ui-font-weight-headline', '600');
    expect(setProperty).toHaveBeenCalledWith('--ui-font-style-headline', 'italic');
  });
});
