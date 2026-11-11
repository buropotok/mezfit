import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_FONT_FAMILY,
  applyFontFamily,
  loadFontFamily,
  normalizeFontFamily,
  saveFontFamily,
} from './fontFamilySettings';

describe('font family preference', () => {
  it('defaults to the existing Zen Maru Gothic font for absent and invalid values', () => {
    expect(loadFontFamily({ getItem: () => null })).toBe(DEFAULT_FONT_FAMILY);
    expect(loadFontFamily({ getItem: () => 'other-font' })).toBe(DEFAULT_FONT_FAMILY);
    expect(normalizeFontFamily({ family: 'inter' })).toBe(DEFAULT_FONT_FAMILY);
    expect(loadFontFamily({ getItem: () => { throw new Error('storage blocked'); } })).toBe(DEFAULT_FONT_FAMILY);
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
    applyFontFamily(DEFAULT_FONT_FAMILY, { setProperty });
    expect(setProperty).toHaveBeenLastCalledWith(
      '--ui-font-family', "'Zen Maru Gothic', sans-serif",
    );
  });
});
