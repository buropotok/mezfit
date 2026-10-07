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

  it('keeps directional edge shading outside the lens and lets presets own their bezel gradient', () => {
    const edgeRule = css.match(/\.ui-glass-surface--directional::before \{[\s\S]*?\n\}/)?.[0];
    const directionalBezelRule = css.match(/\.ui-glass-surface--directional::after \{[\s\S]*?\n\}/)?.[0];
    const liquidConvexRule = css.match(/\.ui-glass-surface--liquid-convex::after \{[\s\S]*?\n\}/)?.[0];
    const bezelOnlyRule = css.match(/\.ui-glass-surface--bezel-only::after \{[\s\S]*?\n\}/)?.[0];

    expect(edgeRule).toContain('calc(0px - var(--ui-glass-surface-edge-outset))');
    expect(edgeRule).toContain('--ui-glass-surface-edge-light-blur');
    expect(edgeRule).toContain('--ui-glass-surface-edge-dark-blur');

    expect(directionalBezelRule).toContain('mask-composite: exclude');
    expect(liquidConvexRule).toContain('conic-gradient');
    expect(liquidConvexRule).toContain('--ui-glass-surface-specular-primary-alpha');
    expect(liquidConvexRule).toContain('--ui-glass-surface-specular-opposite-alpha');
    expect(bezelOnlyRule).toContain('var(--ui-glass-surface-specular-gradient)');
  });

  it('composes the lifted halo into the same GlassSurface box shadow', () => {
    const baseRule = css.match(/\.ui-glass-surface,\n\.ui-glass-surface__contour-material \{[\s\S]*?\n\}/)?.[0];
    const haloRule = css.match(/\.ui-glass-surface--halo-lifted \{[\s\S]*?\n\}/)?.[0];

    expect(baseRule).toContain('var(--ui-glass-surface-halo-shadow)');
    expect(haloRule).toContain('0 0 18px rgb(255 255 255 / 0.16)');
    expect(haloRule).toContain('0 0 36px rgb(170 205 255 / 0.10)');
  });

  it('removes both built-in corner layers for contour surfaces', () => {
    const contourRule = css.match(/\.ui-glass-surface--contour::before,[\s\S]*?\n\}/)?.[0];

    expect(contourRule).toContain('.ui-glass-surface--contour::before');
    expect(contourRule).toContain('.ui-glass-surface--contour::after');
    expect(contourRule).toContain('display: none');
  });
});
