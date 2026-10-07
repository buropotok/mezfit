import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const datePickerCss = readFileSync(
  new URL('./date-picker.css', import.meta.url),
  'utf8',
);

describe('DatePicker top-panel compact viewport contract', () => {
  it('compacts the calendar in short viewports without changing typography presets', () => {
    expect(datePickerCss).toContain('@media (max-height: 520px)');
    expect(datePickerCss).toContain('.ui-date-picker__top-content');
    expect(datePickerCss).toContain('.ui-date-picker__day');
    expect(datePickerCss).toContain('height: 1.75rem');
    expect(datePickerCss).not.toContain('font-size:');
  });
});
