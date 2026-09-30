import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const datePickerCss = readFileSync(
  new URL('./date-picker.css', import.meta.url),
  'utf8',
);

describe('DatePicker baseline CSS', () => {
  it('contains no filter-prewarm workaround styles', () => {
    expect(datePickerCss).not.toContain('.ui-date-picker__prewarm');
    expect(datePickerCss).not.toContain('will-change: backdrop-filter');
  });
});
