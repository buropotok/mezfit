/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(process.cwd(), 'src/ui/time-picker/time-picker.css'), 'utf8',
);
const style = document.createElement('style');
style.textContent = css;
document.head.appendChild(style);
const rules = Array.from(style.sheet?.cssRules ?? [])
  .filter((rule) => 'selectorText' in rule);

function declaration(selector, property) {
  const rule = rules.find((item) => item.selectorText === selector);
  if (!rule) throw new Error(`Missing CSS rule: ${selector}`);
  return rule.style.getPropertyValue(property).trim();
}

describe('Native wheel scrolling', () => {
  it('scales the complete optical layer to 24px while keeping the native scroll window aligned', () => {
    expect(declaration('.ui-time-picker__popover--compact-time', '--ui-time-picker-row-height')).toBe('24px');
    expect(declaration('.ui-time-picker__popover--compact-time .ui-time-picker__lens', 'transform'))
      .toBe('translateY(-50%) scaleY(0.3333333333)');
    expect(css).toContain('rgb(0 0 0) 0 45%, transparent 45% 55%');
    // The SVG source and bitmap map are scaled together by the parent lens
    // rather than cropping unscaled optical data into a shorter viewport.
    expect(declaration('.ui-time-picker__lens', 'height')).toBe('var(--ui-time-picker-lens-height)');
  });

  it('lets inertia pass multiple rows and align on any value', () => {
    expect(declaration('.ui-time-picker__column', 'scroll-snap-type')).toBe('y mandatory');
    expect(declaration('.ui-time-picker__column', 'touch-action')).toBe('pan-y');
    expect(declaration('.ui-time-picker__option', 'scroll-snap-align')).toBe('center');
    expect(declaration('.ui-time-picker__option', 'scroll-snap-stop')).toBe('normal');
    expect(css).not.toContain('--quarter-snap');
    expect(css).not.toContain('--quarter-stop');
  });
});
