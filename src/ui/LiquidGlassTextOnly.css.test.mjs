import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const prototypeCss = readFileSync(
  new URL('./liquid-glass-text-only/prototype.css', import.meta.url),
  'utf8',
);

describe('LiquidGlassTextOnly prototype CSS contract', () => {
  it('uses the approved Caption typography and clipping layers', () => {
    expect(prototypeCss).toContain('font-size: var(--ui-font-size-caption)');
    expect(prototypeCss).toContain('line-height: var(--ui-line-height-caption)');
    expect(prototypeCss).toContain('font-weight: var(--ui-font-weight-medium)');
    expect(prototypeCss).toContain('.selector-mask');
    expect(prototypeCss).toContain('overflow: hidden');
    expect(prototypeCss).toContain('.lens-viewport');
  });
});
