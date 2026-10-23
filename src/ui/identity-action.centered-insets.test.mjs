import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { titleForDate } from './day-schedule/dateMath';

const identityCss = readFileSync(new URL('./identity-action.css', import.meta.url), 'utf8');
const spacingCss = readFileSync(new URL('./tokens/spacing.css', import.meta.url), 'utf8');

describe('centered Identity title insets', () => {
  it('does not add trailing whitespace to the schedule date label', () => {
    const title = titleForDate('2026-10-21', '2026-10-23');
    expect(title).toBe('Ср, 21 октября');
    expect(title).toBe(title.trimEnd());
  });

  it('uses symmetric 8px horizontal insets when the icon is hidden or absent', () => {
    const centered = identityCss.match(/\.ui-identity-action--title-centered\s*\{([^}]*)\}/)?.[1];
    const title = identityCss.match(/\.ui-identity-action--title-centered \.ui-identity-action__title\s*\{([^}]*)\}/)?.[1];
    expect(centered).toContain('justify-content: center');
    expect(centered).toContain('padding-inline: var(--ui-space-2)');
    expect(spacingCss).toContain('--ui-space-2: 0.5rem;');
    expect(title).toContain('text-align: center');
  });

  it('keeps the original insets for icon and avatar identities', () => {
    const base = identityCss.match(/\.ui-identity-action\s*\{([^}]*)\}/)?.[1];
    const label = identityCss.match(/\.ui-identity-action__title\s*\{([^}]*)\}/)?.[1];
    expect(base).toContain('padding: 0.125rem 0.875rem 0.125rem 0.125rem');
    expect(label).toContain('text-overflow: ellipsis');
  });
});
