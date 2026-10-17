import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const navigationCss = readFileSync(new URL('./navigation.css', import.meta.url), 'utf8');
const programCss = readFileSync(new URL('./program/cloud-plan-management.css', import.meta.url), 'utf8');

function rule(source, selector) {
  const start = source.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf('}', start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('glass shadow scroll gutters', () => {
  it('reserves shell gutters inside the default scroller without changing viewport-mode clipping', () => {
    const content = rule(navigationCss, '.navigation-content');
    const shadowGutters = rule(navigationCss, '.navigation-content:not(.navigation-content--viewport)');
    const viewport = rule(navigationCss, '.navigation-content--viewport');

    expect(content).toContain('overflow-y: auto');
    expect(shadowGutters).toContain('width: calc(100% + (var(--page-pad-x) * 2))');
    expect(shadowGutters).toContain('margin-inline: calc(var(--page-pad-x) * -1)');
    expect(shadowGutters).toContain('padding-inline: var(--page-pad-x)');
    expect(shadowGutters).not.toContain('overflow:');
    expect(viewport).toContain('overflow: hidden');
  });

  it('reserves side shadow gutters in phase-day accordions without removing collapse clipping', () => {
    const viewport = rule(programCss, '.cloud-plan-days-viewport');

    expect(viewport).toContain('width: calc(100% + (var(--ui-space-4, 16px) * 2))');
    expect(viewport).toContain('margin-inline: calc(var(--ui-space-4, 16px) * -1)');
    expect(viewport).toContain('padding-inline: var(--ui-space-4, 16px)');
    expect(viewport).toContain('overflow: clip');
  });
});
