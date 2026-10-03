import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const identityActionCss = readFileSync(
  new URL('./identity-action.css', import.meta.url),
  'utf8',
);
const usersOutline = readFileSync(
  new URL('./icons/liquid-glass-users-outline.svg', import.meta.url),
  'utf8',
);
const calendarOutline = readFileSync(
  new URL('./icons/liquid-glass-calendar-outline.svg', import.meta.url),
  'utf8',
);
const menuOutline = readFileSync(
  new URL('./icons/menu-2.svg', import.meta.url),
  'utf8',
);
const backOutline = readFileSync(
  new URL('./icons/chevron-left.svg', import.meta.url),
  'utf8',
);

describe('MezfitNavbar visual contract', () => {
  it('centers double-action icons inside the same 40px visual slot as labeled identity icons', () => {
    const segmentRule = identityActionCss.match(/\.ui-identity-action__segment \{[\s\S]*?\n\}/)?.[0];

    expect(segmentRule).toContain('width: 2.75rem');
    expect(segmentRule).toContain('height: 2.75rem');
    expect(segmentRule).toContain('padding: 0.125rem');
    expect(segmentRule).toContain('place-items: center');
  });

  it('uses the same thin outline stroke weight across navbar icon artwork', () => {
    for (const artwork of [usersOutline, calendarOutline, menuOutline, backOutline]) {
      expect(artwork).toContain('stroke-width="1"');
    }
  });
});
