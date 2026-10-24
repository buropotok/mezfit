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

describe('TimePicker native one-stage minute snap', () => {
  it('allows every minute during precise drags and only quarter hours after a fast swipe', () => {
    expect(declaration('.ui-time-picker__column', 'scroll-snap-type')).toBe('y mandatory');
    expect(declaration('.ui-time-picker__option', 'scroll-snap-align')).toBe('center');
    expect(declaration(
      '.ui-time-picker__column--quarter-snap .ui-time-picker__option:not(.ui-time-picker__option--quarter-stop)',
      'scroll-snap-align',
    )).toBe('none');
    expect(declaration(
      '.ui-time-picker__column--free-momentum .ui-time-picker__option',
      'scroll-snap-stop',
    )).toBe('normal');
  });
});
