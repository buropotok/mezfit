import { describe, expect, it } from 'vitest';
import { normalizeThemeName, THEME_NAMES } from './theme';

describe('global theme names', () => {
  it('accepts every supported theme', () => {
    for (const theme of THEME_NAMES) expect(normalizeThemeName(theme)).toBe(theme);
  });

  it('falls back to default for unknown values', () => {
    expect(normalizeThemeName('neon-random')).toBe('default');
    expect(normalizeThemeName(null)).toBe('default');
  });
});
