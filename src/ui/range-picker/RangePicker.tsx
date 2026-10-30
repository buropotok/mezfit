import {
  TwoColumnPicker,
  type TwoColumnPickerColumn,
} from '../two-column-picker/TwoColumnPicker';
import type { TwoColumnPickerLensMode } from '../two-column-picker/lensMode';

export interface ResistanceRange {
  min: number;
  max: number;
}

const VALUES = Array.from({ length: 30 }, (_, index) => index + 1);
const COLUMNS: readonly [TwoColumnPickerColumn, TwoColumnPickerColumn] = [
  { ariaLabel: 'Минимальная нагрузка, кг', values: VALUES, format: String },
  { ariaLabel: 'Максимальная нагрузка, кг', values: VALUES, format: String },
];

export interface RangePickerProps {
  opened: boolean;
  value: ResistanceRange;
  onChange: (range: ResistanceRange) => void;
  onClose: () => void;
  target: HTMLElement | null;
  lensMode?: TwoColumnPickerLensMode;
}

export function assertResistanceRange(value: ResistanceRange): void {
  if (!Number.isInteger(value.min) || !Number.isInteger(value.max)
    || value.min < 1 || value.max > 30 || value.min > value.max) {
    throw new Error('INVALID_RESISTANCE_RANGE');
  }
}

/** Preserve the actively edited bound; keep both columns in ascending order. */
export function applyRangePickerPart(
  current: ResistanceRange,
  part: 'left' | 'right',
  candidate: number,
): ResistanceRange {
  assertResistanceRange(current);
  if (!Number.isInteger(candidate) || candidate < 1 || candidate > 30) {
    throw new Error('INVALID_RESISTANCE_RANGE');
  }
  return part === 'left'
    ? { min: candidate, max: Math.max(candidate, current.max) }
    : { min: Math.min(current.min, candidate), max: candidate };
}

/** Uses the unchanged TimePicker wheel/lens geometry and native interaction. */
export function RangePicker({ opened, value, onChange, onClose, target, lensMode = 'auto' }: RangePickerProps) {
  assertResistanceRange(value);
  return (
    <TwoColumnPicker
      opened={opened}
      value={{ left: value.min, right: value.max }}
      onChange={({ left, right }) => {
        const next = left !== value.min
          ? applyRangePickerPart(value, 'left', left)
          : applyRangePickerPart(value, 'right', right);
        if (next.min !== value.min || next.max !== value.max) onChange(next);
      }}
      onClose={onClose}
      target={target}
      columns={COLUMNS}
      separator="–"
      ariaLabel="Диапазон нагрузки резинки, кг"
      geometry="compact-time"
      lensMode={lensMode}
    />
  );
}
