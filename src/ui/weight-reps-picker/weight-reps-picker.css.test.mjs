import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const weightRepsPickerCss = readFileSync(
  new URL('./weight-reps-picker.css', import.meta.url),
  'utf8',
);

describe('WeightRepsPicker CSS contract', () => {
  it('keeps the picker split into one half for reps and two quarter-width weight wheels', () => {
    expect(weightRepsPickerCss).toContain(
      'grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr)',
    );
    expect(weightRepsPickerCss).toContain(
      'grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)',
    );
    expect(weightRepsPickerCss).toContain('inset-inline: 16px');
    expect(weightRepsPickerCss).toContain('padding-inline: 16px');
  });
});
