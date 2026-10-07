/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const datePickerCss = readFileSync(
  resolve(process.cwd(), 'src/ui/date-picker/date-picker.css'),
  'utf8',
);

const styleElement = document.createElement('style');
styleElement.textContent = datePickerCss;
document.head.appendChild(styleElement);

const styleRules = Array.from(styleElement.sheet?.cssRules ?? [])
  .filter((rule) => 'selectorText' in rule);

function normalizeSelectorPart(selector) {
  return selector.trim().replace(/\s+/g, ' ');
}

function selectorKey(selector) {
  return selector
    .split(',')
    .map(normalizeSelectorPart)
    .sort()
    .join(',');
}

function ruleFor(selector) {
  const expected = selectorKey(selector);
  const rule = styleRules.find((candidate) => selectorKey(candidate.selectorText) === expected);
  if (!rule) throw new Error(`Missing CSS rule: ${selector}`);
  return rule;
}

function declaration(selector, property) {
  return ruleFor(selector).style.getPropertyValue(property).trim();
}

function normalizeZeroLengths(value) {
  return value.replace(/(^|\s)0px(?=\s|$)/g, (_match, prefix) => `${prefix}0`);
}

describe('DatePicker compact top-panel CSS contract', () => {
  it('keeps the approved compact geometry scoped to horizontal months', () => {
    expect(declaration('.ui-date-picker__days', 'row-gap')).toBe('var(--ui-space-1)');
    expect(declaration('.ui-date-picker__top-content', 'gap')).toBe('var(--ui-space-1)');
    expect(normalizeZeroLengths(declaration('.ui-date-picker__top-content', 'padding'))).toBe('0');
    expect(declaration('.ui-date-picker__months--horizontal', 'align-items')).toBe('flex-start');
    expect(declaration('.ui-date-picker__month--horizontal', 'align-self')).toBe('flex-start');
    expect(declaration('.ui-date-picker__month--horizontal', 'align-content')).toBe('start');
    expect(normalizeZeroLengths(declaration('.ui-date-picker__month--horizontal', 'gap'))).toBe('0');
    expect(normalizeZeroLengths(declaration('.ui-date-picker__month--horizontal', 'padding'))).toBe('0 var(--ui-space-4)');
    expect(declaration('.ui-date-picker__month--horizontal .ui-date-picker__days', 'align-content')).toBe('start');
    expect(normalizeZeroLengths(declaration('.ui-date-picker__month--horizontal .ui-date-picker__days', 'row-gap'))).toBe('0');

    const compactRowRule = ruleFor(
      '.ui-date-picker__month--horizontal .ui-date-picker__empty-day, .ui-date-picker__month--horizontal .ui-date-picker__day',
    );
    expect(compactRowRule.style.getPropertyValue('height').trim()).toBe('1.875rem');
    expect(declaration('.ui-date-picker__month--horizontal .ui-date-picker__day-label', 'width')).toBe('1.875rem');
    expect(declaration('.ui-date-picker__month--horizontal .ui-date-picker__day-label', 'height')).toBe('1.875rem');
  });

  it('preserves distinct today and client-status marker semantics', () => {
    expect(declaration('.ui-date-picker__top-content', '--ui-date-picker-status-scheduled')).toBe('#ffd60a');
    expect(declaration('.ui-date-picker__top-content', '--ui-date-picker-status-completed')).toBe('#30d158');
    expect(declaration('.ui-date-picker__top-content', '--ui-date-picker-status-missed')).toBe('#ff453a');
    expect(declaration('.ui-date-picker__day--today .ui-date-picker__day-label::after', 'border-color')).toBe('var(--ui-color-primary)');
    expect(declaration('.ui-date-picker__day--status-scheduled .ui-date-picker__day-label::before', 'border-color')).toBe('var(--ui-date-picker-status-scheduled)');
    expect(declaration('.ui-date-picker__day--today.ui-date-picker__day--status-scheduled .ui-date-picker__day-label::before', 'inset')).toBe('3px');
    expect(declaration('.ui-date-picker__day.ui-date-picker__day--status-completed .ui-date-picker__day-label, .ui-date-picker__day.ui-date-picker__day--status-completed:active .ui-date-picker__day-label', 'background')).toBe('var(--ui-date-picker-status-completed)');
    expect(declaration('.ui-date-picker__day.ui-date-picker__day--status-missed .ui-date-picker__day-label, .ui-date-picker__day.ui-date-picker__day--status-missed:active .ui-date-picker__day-label', 'background')).toBe('var(--ui-date-picker-status-missed)');
    const selectedStatusSelector = '.ui-date-picker__day--selected.ui-date-picker__day--status-completed .ui-date-picker__day-label::before, .ui-date-picker__day--selected.ui-date-picker__day--status-missed .ui-date-picker__day-label::before';
    expect(declaration(selectedStatusSelector, 'inset')).toBe('4px');
    expect(declaration(selectedStatusSelector, 'border-color')).toBe('var(--ui-color-primary)');
  });

  it('keeps the year, month, and Today toolbar centered as three columns', () => {
    expect(declaration('.ui-date-picker__top-toolbar', 'grid-template-columns')).toBe('1fr auto 1fr');
    expect(declaration('.ui-date-picker__top-month', 'justify-self')).toBe('center');
  });
});
