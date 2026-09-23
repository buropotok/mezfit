import { describe, expect, it } from 'vitest';
import legacyStyles from '../style.css?raw';
import konstaStyles from './konsta.css?raw';

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
