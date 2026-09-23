// @ts-expect-error Vitest runs this test in Node; production tsconfig intentionally omits Node globals.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const legacyStyles = readFileSync(
  new URL('../style.css', import.meta.url),
  'utf8',
);
const konstaStyles = readFileSync(
  new URL('./konsta.css', import.meta.url),
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
    expect(legacyBase).not.toContain('button { min-height:');
    expect(legacyBase).not.toContain('button:disabled');
    expect(legacyBase).not.toContain('button, input, select, textarea');
  });

  it('uses the shared Mezfit platform font stack for Konsta iOS', () => {
    expect(konstaStyles).toContain(
      '--font-ios: var(--ui-font-family);',
    );
  });

  it('enables Tailwind Preflight below the legacy base layer', () => {
    expect(konstaStyles).toContain(
      "@import 'tailwindcss/preflight.css' layer(base);",
    );
  });
});
