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

  it('aligns compact three-wheel columns with the shared TimePicker lens source', () => {
    expect(weightRepsPickerCss).toContain('.ui-weight-reps-picker__popover.ui-time-picker__popover--compact-time .ui-weight-reps-picker__columns');
    expect(weightRepsPickerCss).toContain('inset-inline: calc(100% / 18)');
    expect(weightRepsPickerCss).toContain('width: min(14.4rem, calc(100vw - 72px))');
  });

  it('uses an inline native input area without keypad or viewport-driven sheet geometry', () => {
    expect(weightRepsPickerCss).toContain('.ui-weight-reps-picker__native-entry');
    expect(weightRepsPickerCss).toContain('.ui-weight-reps-picker__native-actions');
    expect(weightRepsPickerCss).not.toContain('.ui-weight-reps-picker__key-dock');
    expect(weightRepsPickerCss).not.toContain('container-type: size');
    expect(weightRepsPickerCss).not.toContain('--ui-weight-reps-number-sheet-height');
    expect(weightRepsPickerCss).not.toContain('100cqh');
  });

});
