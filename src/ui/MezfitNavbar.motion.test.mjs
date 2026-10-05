import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const navbarCss = readFileSync(
  new URL('./mezfit-navbar.css', import.meta.url),
  'utf8',
);
const metaballCss = readFileSync(
  new URL('./NavbarMetaball.css', import.meta.url),
  'utf8',
);

describe('MezfitNavbar back button motion', () => {
  it('moves Back/identity ownership out of the old linear CSS transition', () => {
    expect(navbarCss).not.toContain('.ui-mezfit-navbar__side--left {');
    expect(navbarCss).not.toContain('opacity 320ms');
    expect(navbarCss).not.toContain('--ui-mezfit-navbar-identity-half-width');
    expect(navbarCss).toContain('.ui-mezfit-navbar__side--right {');
  });

  it('keeps navbar metaball visuals separate from interactive controls', () => {
    const visualRule = metaballCss.match(/\.ui-navbar-metaball__surface,\n\.ui-navbar-metaball__liquid \{[^}]*\}/)?.[0];
    const identityRule = metaballCss.match(/\.ui-navbar-metaball__identity-slot \{[^}]*\}/)?.[0];

    expect(visualRule).toContain('pointer-events: none');
    expect(identityRule).toContain('pointer-events: auto');
    expect(metaballCss).toContain('.ui-navbar-metaball__control--back');
  });
});
