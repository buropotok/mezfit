import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const datePickerCss = readFileSync(
  new URL('./date-picker.css', import.meta.url),
  'utf8',
);

describe('DatePicker filter prewarm CSS', () => {
  it('keeps the sticky header blur on a compositor-ready filter layer', () => {
    expect(datePickerCss).toContain('.ui-date-picker__header-blur');
    expect(datePickerCss).toContain('will-change: backdrop-filter');
    expect(datePickerCss).toContain('backdrop-filter: blur(48px) saturate(110%)');
  });
});
