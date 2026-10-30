import { useEffect, useRef } from 'react';
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
  // The underlying wheel may emit several raw positions before applying a
  // normalized controlled prop during native scrolling. Compare raw events to
  // raw events, not the newest normalized props, to preserve the active side.
  const previousRaw = useRef({ left: value.min, right: value.max });
  const latestRange = useRef(value);
  const previousSide = useRef<'left' | 'right' | null>(null);
  const wasOpened = useRef(opened);
  useEffect(() => {
    if (opened && wasOpened.current) return;
    previousRaw.current = { left: value.min, right: value.max };
    latestRange.current = value;
    previousSide.current = null;
    wasOpened.current = opened;
  }, [opened, value.min, value.max]);

  return (
    <TwoColumnPicker
      opened={opened}
      value={{ left: value.min, right: value.max }}
      onChange={({ left, right }) => {
        const rawLeftChanged = left !== previousRaw.current.left;
        const rawRightChanged = right !== previousRaw.current.right;
        const normalizedLeftChanged = left !== latestRange.current.min;
        const normalizedRightChanged = right !== latestRange.current.max;
        // If both raw coordinates shift because the wheel accepted a
        // normalized pair, compare against the last emitted valid range.
        const side = rawLeftChanged !== rawRightChanged
          ? (rawLeftChanged ? 'left' : 'right')
          : normalizedLeftChanged !== normalizedRightChanged
            ? (normalizedLeftChanged ? 'left' : 'right')
            : previousSide.current;
        previousRaw.current = { left, right };
        if (!side) return;
        previousSide.current = side;
        const current = latestRange.current;
        const next = applyRangePickerPart(current, side, side === 'left' ? left : right);
        latestRange.current = next;
        if (next.min !== current.min || next.max !== current.max) onChange(next);
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
