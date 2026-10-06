import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GLASS_SETTINGS,
  loadBrowserGlassSettings,
  loadGlassSettings,
  saveBrowserGlassSettings,
  saveGlassSettings,
} from './glassSettings';

describe('glassSettings', () => {
  it('loads a valid persisted preset, optics and blur value', () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({ preset: 'clear', optics: true, blur: 18 })),
    };

    expect(loadGlassSettings(storage)).toEqual({ preset: 'clear', optics: true, blur: 18 });
  });

  it('backfills blur from the selected preset for legacy stored settings', () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({ preset: 'frosted', optics: false })),
    };

    expect(loadGlassSettings(storage)).toEqual({ preset: 'frosted', optics: false, blur: 14 });
  });

  it('accepts the liquid convex preset as a persisted glass setting', () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({ preset: 'liquidConvex', optics: false })),
    };

    expect(loadGlassSettings(storage)).toEqual({ preset: 'liquidConvex', optics: false, blur: 0 });
  });

  it('falls back per field when persisted settings are invalid', () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({ preset: 'unknown', optics: 'yes' })),
    };

    expect(loadGlassSettings(storage)).toEqual(DEFAULT_GLASS_SETTINGS);
  });

  it('persists the typed glass settings payload', () => {
    const storage = { setItem: vi.fn() };

    saveGlassSettings(storage, { preset: 'lens', optics: true, blur: 7 });

    expect(storage.setItem).toHaveBeenCalledWith(
      'mezfit.glassSettings',
      JSON.stringify({ preset: 'lens', optics: true, blur: 7 }),
    );
  });

  it('falls back when acquiring browser storage throws', () => {
    expect(loadBrowserGlassSettings(() => {
      throw new DOMException('Denied', 'SecurityError');
    })).toEqual(DEFAULT_GLASS_SETTINGS);
  });

  it('ignores denied browser storage while persisting', () => {
    expect(() => saveBrowserGlassSettings(
      { preset: 'clear', optics: true, blur: 2 },
      () => {
        throw new DOMException('Denied', 'SecurityError');
      },
    )).not.toThrow();
  });
});
