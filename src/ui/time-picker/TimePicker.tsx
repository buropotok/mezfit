import {
  TwoColumnPicker,
  type TwoColumnPickerColumn,
} from '../two-column-picker/TwoColumnPicker';
import type { TwoColumnPickerLensMode } from '../two-column-picker/lensMode';
import {
  formatLocalTime,
  parseLocalTime,
  type LocalTime,
} from './timePickerTime';

const HOUR_VALUES = Array.from({ length: 24 }, (_, index) => index);
const MINUTE_VALUES = Array.from({ length: 60 }, (_, index) => index);

function formatUnit(value: number) {
  return String(value).padStart(2, '0');
}

const TIME_COLUMNS: readonly [TwoColumnPickerColumn, TwoColumnPickerColumn] = [
  {
    ariaLabel: 'Часы',
    values: HOUR_VALUES,
    format: formatUnit,
  },
  {
    ariaLabel: 'Минуты',
    values: MINUTE_VALUES,
    format: formatUnit,
    freeMomentum: true,
  },
];

export type TimePickerLensMode = TwoColumnPickerLensMode;

export interface TimePickerProps {
  opened: boolean;
  value: LocalTime;
  onChange: (value: LocalTime) => void;
  onClose: () => void;
  target: HTMLElement | null;
  lensMode?: TimePickerLensMode;
}

export function TimePicker({
  opened,
  value,
  onChange,
  onClose,
  target,
  lensMode = 'auto',
}: TimePickerProps) {
  const parsedValue = parseLocalTime(value);
  if (!parsedValue) throw new Error('TimePicker value must be a valid HH:mm local time');

  return (
    <TwoColumnPicker
      opened={opened}
      target={target}
      value={{ left: parsedValue.hour, right: parsedValue.minute }}
      columns={TIME_COLUMNS}
      separator=":"
      ariaLabel="Выбор времени"
      lensMode={lensMode}
      onChange={({ left, right }) => onChange(formatLocalTime(left, right))}
      onClose={onClose}
    />
  );
}

export type { LocalTime };
