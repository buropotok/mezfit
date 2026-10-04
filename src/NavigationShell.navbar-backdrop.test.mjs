import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const navigationCss = readFileSync(
  new URL('./navigation.css', import.meta.url),
  'utf8',
);
const navigationShellSource = readFileSync(
  new URL('./NavigationShell.tsx', import.meta.url),
  'utf8',
);

describe('NavigationShell navbar backdrop', () => {
  it('uses a transparent masked backdrop with a maximum 5px blur', () => {
    const backdropRule = navigationCss.match(/\.navigation-navbar-backdrop \{[^}]*\}/)?.[0];

    expect(backdropRule).toContain('background: transparent');
    expect(backdropRule).toContain('-webkit-backdrop-filter: blur(5px)');
    expect(backdropRule).toContain('backdrop-filter: blur(5px)');
    expect(backdropRule).toContain('linear-gradient(to bottom, black 0%, transparent 100%)');
    expect(backdropRule).toContain('bottom: calc(var(--space-3) * -1)');
  });

  it('renders the blur layer separately from the navbar control surface', () => {
    expect(navigationShellSource).toContain('className="navigation-navbar-backdrop"');
    expect(navigationShellSource).toContain('className="navigation-navbar-control"');
  });
});
