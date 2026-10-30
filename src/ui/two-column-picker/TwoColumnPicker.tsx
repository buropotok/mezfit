import type { ReactNode } from 'react';
import {
  WheelPicker,
  type WheelPickerColumn,
} from '../wheel-picker/WheelPicker';
import type { TwoColumnPickerLensMode } from './lensMode';

export type TwoColumnPickerColumn = WheelPickerColumn;
export type TwoColumnPickerSide = 'left' | 'right';
export interface TwoColumnPickerParts { left: number; right: number }
export interface TwoColumnPickerProps {
  opened: boolean;
  value: TwoColumnPickerParts;
  onChange: (value: TwoColumnPickerParts) => void;
  onClose: () => void;
  target: HTMLElement | null;
  columns: readonly [TwoColumnPickerColumn, TwoColumnPickerColumn];
  ariaLabel: string;
  separator?: string;
  /** Optional content beneath the two wheels, rendered by the existing WheelPicker footer. */
  footer?: ReactNode;
  lensMode?: TwoColumnPickerLensMode;
  geometry?: 'standard' | 'compact-time';
}

const EMPTY_COLUMN: WheelPickerColumn = { ariaLabel: '', values: [0], format: String };
const LENS_XS = [62, 226, 0] as const;

export function TwoColumnPicker({
  value, onChange, columns, separator, ...props
}: TwoColumnPickerProps) {
  return (
    <WheelPicker {...props} columnCount={2}
      value={{ first: value.left, second: value.right, third: 0 }}
      columns={{ first: columns[0], second: columns[1], third: EMPTY_COLUMN }}
      lensXs={LENS_XS}
      separators={separator ? [{ x: 144, label: separator }] : undefined}
      onChange={({ first, second }) => onChange({ left: first, right: second })}
    />
  );
}
