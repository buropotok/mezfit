import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const navbarCss = readFileSync(
  new URL('./mezfit-navbar.css', import.meta.url),
  'utf8',
);

describe('MezfitNavbar back button motion', () => {
  it('parks the hidden Back control under the identity visual and makes it fully transparent', () => {
    const layoutRule = navbarCss.match(/\.ui-mezfit-navbar__layout \{[^}]*\}/)?.[0];
    const hiddenBackRule = navbarCss.match(/\.ui-mezfit-navbar__side--left \{[^}]*\}/)?.[0];

    expect(layoutRule).toContain('--ui-mezfit-navbar-identity-width: min(224px, calc(100% - 164px))');
    expect(layoutRule).toContain('--ui-mezfit-navbar-identity-half-width: min(112px, calc(50% - 82px))');
    expect(hiddenBackRule).toContain('left: calc(50% - 22px - var(--ui-mezfit-navbar-identity-half-width))');
    expect(hiddenBackRule).toContain('transform: translateX(0)');
    expect(hiddenBackRule).toContain('opacity: 0');
    expect(navbarCss).toContain('.ui-mezfit-navbar__side--left .ui-identity-action--disabled {\n  opacity: 1;\n}');
  });

  it('uses the same 320ms easing for Back movement and visibility in both directions', () => {
    const movingRule = navbarCss.match(/\.ui-mezfit-navbar__identity,\n\.ui-mezfit-navbar__side \{[^}]*\}/)?.[0];
    const visibleBackRule = navbarCss.match(/\.ui-mezfit-navbar__layout\[data-entry-phase='spread'\] \.ui-mezfit-navbar__side--left,[\s\S]*?\{[^}]*\}/)?.[0];

    expect(movingRule).toContain('left 320ms cubic-bezier(0.2, 0, 0, 1)');
    expect(movingRule).toContain('transform 320ms cubic-bezier(0.2, 0, 0, 1)');
    expect(movingRule).toContain('opacity 320ms cubic-bezier(0.2, 0, 0, 1)');
    expect(visibleBackRule).toContain('left: 0');
    expect(visibleBackRule).toContain('transform: translateX(0)');
    expect(visibleBackRule).toContain('opacity: 1');
  });
});
