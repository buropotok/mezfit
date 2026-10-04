import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const navbarCss = readFileSync(
  new URL('./mezfit-navbar.css', import.meta.url),
  'utf8',
);
const navbarSource = readFileSync(
  new URL('./MezfitNavbar.tsx', import.meta.url),
  'utf8',
);
const navigationCss = readFileSync(
  new URL('../navigation.css', import.meta.url),
  'utf8',
);

describe('MezfitNavbar backdrop', () => {
  it('uses one transparent gradient backdrop capped at 3px blur', () => {
    const backdropRule = navbarCss.match(/\.ui-mezfit-navbar__backdrop \{[^}]*\}/)?.[0];

    expect(backdropRule).toContain('background: transparent');
    expect(backdropRule).toContain('-webkit-backdrop-filter: blur(3px)');
    expect(backdropRule).toContain('backdrop-filter: blur(3px)');
    expect(backdropRule).toContain('linear-gradient(to bottom, #000 0%, #000 calc(100% - 2rem), transparent 100%)');
    expect(backdropRule).toContain('bottom: -2rem;');
  });

  it('keeps backdrop ownership inside MezfitNavbar without a second shell or Konsta navbar backdrop', () => {
    expect(navbarSource).toContain('className="ui-mezfit-navbar__backdrop"');
    expect(navbarSource).not.toContain("from 'konsta/react'");
    expect(navigationCss).not.toContain('navigation-navbar-backdrop');
    expect(navigationCss).not.toContain('backdrop-filter');
    expect(navigationCss).toContain('height: 0');
    expect(navigationCss).toContain('min-height: 100dvh');
  });
});
