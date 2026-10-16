import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const prototypeCss = readFileSync(
  new URL('./liquid-glass-text-only/prototype.css', import.meta.url),
  'utf8',
);

describe('LiquidGlassTextOnly prototype CSS contract', () => {
  it('distributes spare width equally without shrinking slots or losing horizontal scrolling', () => {
    const tabStrip = prototypeCss.match(/\.tab-strip\s*\{([^}]*)\}/)?.[1] ?? '';
    const tabLink = prototypeCss.match(/\.tab-link\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(tabStrip).toMatch(/overflow-x:\s*auto;/);
    expect(tabLink).toMatch(/flex:\s*1 0 auto;/);
    expect(tabLink).toMatch(/width:\s*max-content;/);
  });

  it('uses the approved Caption typography and clipping layers', () => {
    expect(prototypeCss).toContain('font-size: var(--ui-font-size-caption)');
    expect(prototypeCss).toContain('line-height: var(--ui-line-height-caption)');
    expect(prototypeCss).toContain('font-weight: var(--ui-font-weight-medium)');
    expect(prototypeCss).toContain('.selector-mask');
    expect(prototypeCss).toContain('overflow: hidden');
    expect(prototypeCss).toContain('.lens-viewport');
  });
});
