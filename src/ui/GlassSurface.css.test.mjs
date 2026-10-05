import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./GlassSurface.css', import.meta.url), 'utf8');

describe('GlassSurface bezel layers', () => {
  it('keeps top-left and bottom-right highlights on independently controlled layers', () => {
    const bezelRules = [...css.matchAll(/\.ui-glass-surface::(?:before|after) \{[\s\S]*?\n\}/g)]
      .map(match => match[0]);
    const topLeftRule = bezelRules.find(rule => rule.includes('--ui-glass-surface-bezel-top-left'));
    const bottomRightRule = bezelRules.find(rule => rule.includes('--ui-glass-surface-bezel-bottom-right'));

    expect(topLeftRule).toContain('inset 3px 3px 0 -3.5px');
    expect(topLeftRule).toContain('inset 0.5px 0.5px 0');
    expect(topLeftRule).toContain('var(--ui-glass-surface-bezel-top-left)');
    expect(topLeftRule).not.toContain('inset -3px -3px 0 -3.5px');

    expect(bottomRightRule).toContain('inset -3px -3px 0 -3.5px');
    expect(bottomRightRule).toContain('inset -0.5px -0.5px 0');
    expect(bottomRightRule).toContain('var(--ui-glass-surface-bezel-bottom-right)');
    expect(bottomRightRule).not.toContain('inset 3px 3px 0 -3.5px');
  });

  it('removes both built-in corner layers for contour surfaces', () => {
    const contourRule = css.match(/\.ui-glass-surface--contour::before,[\s\S]*?\n\}/)?.[0];

    expect(contourRule).toContain('.ui-glass-surface--contour::before');
    expect(contourRule).toContain('.ui-glass-surface--contour::after');
    expect(contourRule).toContain('display: none');
  });
});
