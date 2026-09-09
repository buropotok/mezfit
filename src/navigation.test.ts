import { describe, expect, it } from 'vitest';
import navigationSource from './NavigationShell.tsx?raw';

describe('navigation production artwork', () => {
  it('does not contain the temporary Unicode navigation glyphs', () => {
    for (const glyph of ['👥', '⚙', '◆', '▤', '□', '↶', '↗', '✓', 'ⓘ', '←', '☰']) {
      expect(navigationSource).not.toContain(glyph);
    }
  });
});
