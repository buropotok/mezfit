import {
  TwoColumnPicker,
  type TwoColumnPickerColumn,
} from '../two-column-picker/TwoColumnPicker';

const HUNDREDS_VALUES = [0, 1, 2, 3] as const;
const LOWER_VALUES = Array.from({ length: 100 }, (_, index) => index);

function formatHundreds(value: number) {
  return value === 0 ? '' : String(value);
}

function formatHundredsAria(value: number) {
  return value === 0 ? 'Без сотен' : String(value);
}

function formatLower(value: number) {
  return String(value).padStart(2, '0');
}

const NUMBER_COLUMNS: readonly [TwoColumnPickerColumn, TwoColumnPickerColumn] = [
  {
    ariaLabel: 'Сотни',
    values: HUNDREDS_VALUES,
    format: formatHundreds,
    formatAria: formatHundredsAria,
  },
  {
    ariaLabel: 'Последние две цифры',
    values: LOWER_VALUES,
    format: formatLower,
    freeMomentum: true,
  },
];

export interface NumPickerProps {
  opened: boolean;
  value: number;
  onChange: (value: number) => void;
  onClose: () => void;
  target: HTMLElement | null;
}

function assertNumPickerValue(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 399) {
    throw new Error('NumPicker value must be an integer from 0 to 399');
  }
}

export function NumPicker({
  opened,
  value,
  onChange,
  onClose,
  target,
}: NumPickerProps) {
  assertNumPickerValue(value);

  const hundreds = Math.floor(value / 100);
  const lower = value % 100;

  return (
    <TwoColumnPicker
      opened={opened}
      target={target}
      value={{ left: hundreds, right: lower }}
      columns={NUMBER_COLUMNS}
      ariaLabel="Выбор числа"
      onChange={({ left, right }) => onChange(left * 100 + right)}
      onClose={onClose}
    />
  );
}
