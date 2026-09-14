import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGlobalTheme, normalizeThemeName, THEME_NAMES } from './theme';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('global theme names', () => {
  it('accepts every supported theme', () => {
    for (const theme of THEME_NAMES) expect(normalizeThemeName(theme)).toBe(theme);
  });

  it('falls back to default for unknown values', () => {
    expect(normalizeThemeName('neon-random')).toBe('default');
    expect(normalizeThemeName(null)).toBe('default');
  });

  it('aborts a config request whose response body stalls and applies the default theme', async () => {
    vi.useFakeTimers();
    const dataset: Record<string, string> = {};
    const json = vi.fn(() => new Promise<never>(() => undefined));
    vi.stubGlobal('document', { documentElement: { dataset } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json }));
    const abort = vi.spyOn(AbortController.prototype, 'abort');

    const pending = loadGlobalTheme();
    await vi.advanceTimersByTimeAsync(5000);

    await expect(pending).resolves.toBe('default');
    expect(json).toHaveBeenCalledTimes(1);
    expect(abort).toHaveBeenCalledTimes(1);
    expect(dataset.theme).toBe('default');
  });
});
