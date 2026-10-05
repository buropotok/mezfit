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
const metaballSource = readFileSync(
  new URL('./NavbarMetaball.tsx', import.meta.url),
  'utf8',
);

describe('MezfitNavbar back button motion', () => {
  it('moves Back/identity ownership out of the old linear CSS transition', () => {
    expect(navbarCss).not.toContain('.ui-mezfit-navbar__side--left {');
    expect(navbarCss).not.toContain('opacity 320ms');
    expect(navbarCss).not.toContain('--ui-mezfit-navbar-identity-half-width');
    expect(navbarCss).toContain('.ui-mezfit-navbar__side--right {');
  });

  it('keeps liquid visuals non-interactive while IdentityAction owns controls', () => {
    const liquidRule = metaballCss.match(/\.ui-navbar-metaball__liquid \{[^}]*\}/)?.[0];
    const identityRule = metaballCss.match(/\.ui-navbar-metaball__identity-slot \{[^}]*\}/)?.[0];

    expect(liquidRule).toContain('pointer-events: none');
    expect(identityRule).toContain('pointer-events: auto');
    expect(metaballSource).toContain('<IdentityAction');
    expect(metaballSource).toContain('glass={movingGlass}');
  });
});
