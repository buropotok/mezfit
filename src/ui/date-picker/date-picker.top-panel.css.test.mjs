import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const datePickerCss = readFileSync(
  new URL('./date-picker.css', import.meta.url),
  'utf8',
);

describe('DatePicker compact top-panel CSS contract', () => {
  it('keeps horizontal calendar rows dense without changing the legacy picker spacing', () => {
    expect(datePickerCss).toContain('.ui-date-picker__days {\n  row-gap: var(--ui-space-1);');
    expect(datePickerCss).toContain('.ui-date-picker__month--horizontal .ui-date-picker__days {\n  row-gap: 0;');
  });

  it('uses a three-column toolbar for year, month, and Today', () => {
    expect(datePickerCss).toContain('grid-template-columns: 1fr auto 1fr;');
    expect(datePickerCss).toContain('.ui-date-picker__top-month');
  });
});
