import {
  TwoColumnPicker,
  type TwoColumnPickerColumn,
} from '../two-column-picker/TwoColumnPicker';

const KILOMETERS = Array.from({ length: 101 }, (_, index) => index);
const METERS = Array.from({ length: 1000 }, (_, index) => index);

const COLUMNS: readonly [TwoColumnPickerColumn, TwoColumnPickerColumn] = [
  {
    ariaLabel: 'Километры',
    values: KILOMETERS,
    format: String,
    formatAria: (value) => `${value} км`,
    fixedUnit: 'км',
  },
  {
    ariaLabel: 'Метры',
    values: METERS,
    format: (value) => String(value).padStart(3, '0'),
    formatAria: (value) => `${String(value).padStart(3, '0')} м`,
    fixedUnit: 'м',
  },
];

export interface DistancePickerProps {
  opened: boolean;
  value: number;
  onChange: (distanceMeters: number) => void;
  onClose: () => void;
  target: HTMLElement | null;
}

export function DistancePicker({ opened, value, onChange, onClose, target }: DistancePickerProps) {
  if (!Number.isInteger(value) || value < 0 || value > 100999) {
    throw new Error('DistancePicker value must be an integer from 0 to 100999 meters');
  }

  return (
    <TwoColumnPicker
      opened={opened}
      target={target}
      value={{ left: Math.floor(value / 1000), right: value % 1000 }}
      columns={COLUMNS}
      ariaLabel="Выбор дистанции"
      onChange={({ left, right }) => onChange(left * 1000 + right)}
      onClose={onClose}
    />
  );
}
