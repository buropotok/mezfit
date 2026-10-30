import { WheelPicker, type WheelPickerColumn } from '../wheel-picker/WheelPicker';

export interface OneColumnPickerProps {
  opened: boolean;
  value: number;
  onChange: (value: number) => void;
  onClose: () => void;
  target: HTMLElement | null;
  column: WheelPickerColumn;
  ariaLabel: string;
}
const EMPTY_COLUMN: WheelPickerColumn = { ariaLabel: '', values: [0], format: String };
const LENS_XS = [144, 0, 0] as const;

export function OneColumnPicker({ value, onChange, column, ...props }: OneColumnPickerProps) {
  return <WheelPicker {...props} columnCount={1}
    value={{ first: value, second: 0, third: 0 }}
    columns={{ first: column, second: EMPTY_COLUMN, third: EMPTY_COLUMN }}
    lensXs={LENS_XS} onChange={({ first }) => onChange(first)} />;
}
