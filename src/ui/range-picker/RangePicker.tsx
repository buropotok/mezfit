import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  TwoColumnPicker,
  type TwoColumnPickerColumn,
} from '../two-column-picker/TwoColumnPicker';
import type { TwoColumnPickerLensMode } from '../two-column-picker/lensMode';

export interface ResistanceRange {
  min: number;
  max: number;
}

export interface RangePickerProps {
  opened: boolean;
  value: ResistanceRange;
  onChange: (range: ResistanceRange) => void;
  onClose: () => void;
  target: HTMLElement | null;
  lensMode?: TwoColumnPickerLensMode;
  /** Inclusive wheel bounds; editable range itself remains value.min/value.max. */
  minAllowed?: number;
  maxAllowed?: number;
  /** Optional controls beneath the wheels, e.g. a color picker. */
  footer?: ReactNode;
}

export function assertResistanceRange(value: ResistanceRange, minAllowed = 1, maxAllowed = 30): void {
  if (!Number.isSafeInteger(value.min) || !Number.isSafeInteger(value.max)
    || value.min < minAllowed || value.max > maxAllowed || value.min > value.max) {
    throw new Error('INVALID_RESISTANCE_RANGE');
  }
}

/** Preserve the actively edited bound; keep both columns in ascending order. */
export function applyRangePickerPart(
  current: ResistanceRange,
  part: 'left' | 'right',
  candidate: number,
  minAllowed = 1,
  maxAllowed = 30,
): ResistanceRange {
  assertResistanceRange(current, minAllowed, maxAllowed);
  if (!Number.isSafeInteger(candidate) || candidate < minAllowed || candidate > maxAllowed) {
    throw new Error('INVALID_RESISTANCE_RANGE');
  }
  return part === 'left'
    ? { min: candidate, max: Math.max(candidate, current.max) }
    : { min: Math.min(current.min, candidate), max: candidate };
}

/** Uses the unchanged TimePicker wheel/lens geometry and native interaction. */
export function RangePicker({ opened, value, onChange, onClose, target, lensMode = 'auto',
  minAllowed = 1, maxAllowed = 30, footer }: RangePickerProps) {
  if (!Number.isSafeInteger(minAllowed) || !Number.isSafeInteger(maxAllowed)
    || minAllowed < 1 || minAllowed > maxAllowed) {
    throw new Error('INVALID_RESISTANCE_LIMITS');
  }
  assertResistanceRange(value, minAllowed, maxAllowed);
  const columns = useMemo<readonly [TwoColumnPickerColumn, TwoColumnPickerColumn]>(() => {
    const values = Array.from({ length: maxAllowed - minAllowed + 1 }, (_, index) => minAllowed + index);
    return [
      { ariaLabel: 'Минимальная нагрузка, кг', values, format: String },
      { ariaLabel: 'Максимальная нагрузка, кг', values, format: String },
    ];
  }, [minAllowed, maxAllowed]);
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
        const next = applyRangePickerPart(current, side, side === 'left' ? left : right, minAllowed, maxAllowed);
        latestRange.current = next;
        if (next.min !== current.min || next.max !== current.max) onChange(next);
      }}
      onClose={onClose}
      target={target}
      columns={columns}
      footer={footer}
      separator="–"
      ariaLabel="Диапазон нагрузки резинки, кг"
      geometry="compact-time"
      lensMode={lensMode}
    />
  );
}
