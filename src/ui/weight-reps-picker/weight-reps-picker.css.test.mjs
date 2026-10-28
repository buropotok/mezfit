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
    expect(weightRepsPickerCss).toContain('grid-template-columns: repeat(3, var(--ui-weight-reps-key-cell))');
    expect(weightRepsPickerCss).toContain('width: 5.5rem');
    expect(weightRepsPickerCss).toContain('height: 5.5rem');
    expect(weightRepsPickerCss).toContain('grid-column: 2');
    expect(weightRepsPickerCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(weightRepsPickerCss).toContain('ui-weight-reps-input-blink');
  });

  it('removes the small readout and fills the measured space with an adaptive square grid', () => {
    expect(weightRepsPickerCss).not.toContain('.ui-weight-reps-picker__lens-value');
    expect(weightRepsPickerCss).toContain('.ui-mezfit-bottom-sheet.ui-weight-reps-picker__number-sheet');
    expect(weightRepsPickerCss).toContain('container-type: size');
    expect(weightRepsPickerCss).toContain('min(calc(100cqw / 3), calc(100cqh / 4))');
    expect(weightRepsPickerCss).toContain('--ui-weight-reps-number-sheet-height');
    expect(weightRepsPickerCss).not.toContain('min-height: 100%');
    expect(weightRepsPickerCss).not.toContain('.ui-weight-reps-picker__number-readout');
  });
});
