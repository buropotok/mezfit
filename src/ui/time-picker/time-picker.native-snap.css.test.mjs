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
  it('scales only the optical SVG inside an unscaled 36px capsule', () => {
    expect(declaration('.ui-time-picker__popover--compact-time', '--ui-time-picker-row-height')).toBe('36px');
    expect(declaration('.ui-time-picker__popover--compact-time .ui-time-picker__lens', 'border-radius')).toBe('999px');
    expect(declaration('.ui-time-picker__popover--compact-time .ui-time-picker__lens', 'overflow')).toBe('hidden');
    expect(declaration('.ui-time-picker__popover--compact-time .ui-time-picker__lens svg', 'transform'))
      .toBe('translateY(-50%) scaleY(0.5)');
    expect(css).toContain('rgb(0 0 0) 0 42.5%, transparent 42.5% 57.5%');
    // The filter bitmap stays at its original resolution while the inner SVG
    // is scaled; the outer capsule retains normal round end caps.
    expect(declaration('.ui-time-picker__lens', 'height')).toBe('var(--ui-time-picker-lens-height)');
  });

  it('keeps every wheel free during native momentum', () => {
    expect(declaration('.ui-time-picker__popover--compact-time .ui-time-picker__column', 'scroll-snap-type'))
      .toBe('none');
    expect(declaration('.ui-time-picker__column', 'scroll-snap-type')).toBe('none');
  });

  it('lets inertia pass multiple rows and align on any value', () => {
    expect(declaration('.ui-time-picker__column', 'scroll-snap-type')).toBe('none');
    expect(declaration('.ui-time-picker__column', 'touch-action')).toBe('pan-y');
    expect(declaration('.ui-time-picker__option', 'scroll-snap-align')).toBe('center');
    expect(declaration('.ui-time-picker__option', 'scroll-snap-stop')).toBe('normal');
    expect(css).not.toContain('--quarter-snap');
    expect(css).not.toContain('--quarter-stop');
  });
});
