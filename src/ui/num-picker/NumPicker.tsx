import { OneColumnPicker } from '../one-column-picker/OneColumnPicker';

const NUMBER_COLUMN = { ariaLabel: 'Число', values: Array.from({ length: 1000 }, (_, index) => index), format: String };

export interface NumPickerProps {
  opened: boolean;
  value: number;
  onChange: (value: number) => void;
  onClose: () => void;
  target: HTMLElement | null;
}

function assertNumPickerValue(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 999) {
    throw new Error('NumPicker value must be an integer from 0 to 999');
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

  return (
    <OneColumnPicker
      opened={opened}
      target={target}
      value={value}
      column={NUMBER_COLUMN}
      ariaLabel="Выбор числа"
      onChange={onChange}
      onClose={onClose}
    />
  );
}
