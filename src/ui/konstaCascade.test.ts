import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const legacyStyles = readFileSync(
  fileURLToPath(new URL('../style.css', import.meta.url)),
  'utf8',
);
const konstaStyles = readFileSync(
  fileURLToPath(new URL('./konsta.css', import.meta.url)),
  'utf8',
);

describe('Konsta cascade ownership', () => {
  it('keeps legacy global element styles below Konsta utilities', () => {
    expect(konstaStyles).toContain(
      '@layer theme, base, legacy-base, components, utilities;',
    );

    const layerStart = legacyStyles.indexOf('@layer legacy-base {');
    const layerEnd = legacyStyles.indexOf('\n}\n\n.center,', layerStart);

    expect(layerStart).toBeGreaterThanOrEqual(0);
    expect(layerEnd).toBeGreaterThan(layerStart);

    const legacyBase = legacyStyles.slice(layerStart, layerEnd);
    expect(legacyBase).toContain(
      'button, input, select, textarea { font: inherit; }',
    );
    expect(legacyBase).toContain('button { min-height: var(--control-h); }');
    expect(legacyBase).toContain(
      'button:disabled { cursor: wait; opacity: .55; }',
    );
  });

  it('does not enable Tailwind Preflight for the legacy application', () => {
    expect(konstaStyles).not.toContain("@import 'tailwindcss';");
  });
});
