import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_FONT_FAMILY,
  applyFontFamily,
  loadFontFamily,
  normalizeFontFamily,
  saveFontFamily,
} from './fontFamilySettings';

describe('font family preference', () => {
  it('defaults to Inter for absent and invalid values', () => {
    expect(DEFAULT_FONT_FAMILY).toBe('inter');
    expect(loadFontFamily({ getItem: () => null })).toBe('inter');
    expect(loadFontFamily({ getItem: () => 'other-font' })).toBe(DEFAULT_FONT_FAMILY);
    expect(normalizeFontFamily({ family: 'inter' })).toBe(DEFAULT_FONT_FAMILY);
    expect(loadFontFamily({ getItem: () => { throw new Error('storage blocked'); } })).toBe(DEFAULT_FONT_FAMILY);
  });

  it('ignores auto-saved v1 Zen defaults, but remembers explicit v2 Zen choices', () => {
    const data = new Map([['mezfit.fontFamily.v1', 'zen-maru-gothic']]);
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value); },
    };

    expect(loadFontFamily(storage)).toBe('inter');
    saveFontFamily(storage, 'zen-maru-gothic');
    expect(data.get('mezfit.fontFamily.v2')).toBe('zen-maru-gothic');
    expect(loadFontFamily(storage)).toBe('zen-maru-gothic');
  });

  it('round-trips Inter through local storage', () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value); },
    };
    saveFontFamily(storage, 'inter');
    expect(loadFontFamily(storage)).toBe('inter');
  });

  it('updates only the shared CSS family token for both fonts', () => {
    const setProperty = vi.fn();
    applyFontFamily('inter', { setProperty });
    expect(setProperty).toHaveBeenLastCalledWith(
      '--ui-font-family', "'Inter', 'Zen Maru Gothic', sans-serif",
    );
    applyFontFamily('zen-maru-gothic', { setProperty });
    expect(setProperty).toHaveBeenLastCalledWith(
      '--ui-font-family', "'Zen Maru Gothic', sans-serif",
    );
  });
});
