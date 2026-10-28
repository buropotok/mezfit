import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const weightRepsPickerCss = readFileSync(
  new URL('./weight-reps-picker.css', import.meta.url),
  'utf8',
);

describe('WeightRepsPicker CSS contract', () => {
  it('keeps original lens anchors for two static controls and one fractional wheel', () => {
    expect(weightRepsPickerCss).toContain(
      'grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr)',
    );
    expect(weightRepsPickerCss).toContain(
      'grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)',
    );
    expect(weightRepsPickerCss).toContain('inset-inline: 16px');
    expect(weightRepsPickerCss).toContain('padding-inline: 16px');
  });

  it('lays out the FAB keypad as equally sized square cells with the zero in column two', () => {
    expect(weightRepsPickerCss).toContain('grid-template-columns: repeat(3, 5.5rem)');
    expect(weightRepsPickerCss).toContain('width: 5.5rem');
    expect(weightRepsPickerCss).toContain('height: 5.5rem');
    expect(weightRepsPickerCss).toContain('grid-column: 2');
    expect(weightRepsPickerCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(weightRepsPickerCss).toContain('ui-weight-reps-input-blink');
  });
});
