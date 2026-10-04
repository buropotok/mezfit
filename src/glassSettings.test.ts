import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GLASS_SETTINGS,
  loadBrowserGlassSettings,
  loadGlassSettings,
  saveBrowserGlassSettings,
  saveGlassSettings,
} from './glassSettings';

describe('glassSettings', () => {
  it('loads a valid persisted preset and optics value', () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({ preset: 'clear', optics: true })),
    };

    expect(loadGlassSettings(storage)).toEqual({ preset: 'clear', optics: true });
  });

  it('falls back per field when persisted settings are invalid', () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({ preset: 'unknown', optics: 'yes' })),
    };

    expect(loadGlassSettings(storage)).toEqual(DEFAULT_GLASS_SETTINGS);
  });

  it('persists the typed glass settings payload', () => {
    const storage = { setItem: vi.fn() };

    saveGlassSettings(storage, { preset: 'lens', optics: true });

    expect(storage.setItem).toHaveBeenCalledWith(
      'mezfit.glassSettings',
      JSON.stringify({ preset: 'lens', optics: true }),
    );
  });

  it('falls back when acquiring browser storage throws', () => {
    expect(loadBrowserGlassSettings(() => {
      throw new DOMException('Denied', 'SecurityError');
    })).toEqual(DEFAULT_GLASS_SETTINGS);
  });

  it('ignores denied browser storage while persisting', () => {
    expect(() => saveBrowserGlassSettings(
      { preset: 'clear', optics: true },
      () => {
        throw new DOMException('Denied', 'SecurityError');
      },
    )).not.toThrow();
  });
});
