import {
  ThreeColumnPicker,
  type ThreeColumnPickerColumn,
  type ThreeColumnPickerPart,
  type ThreeColumnPickerParts,
} from '../three-column-picker/ThreeColumnPicker';
import './duration-picker.css';

const HOURS = Array.from({ length: 24 }, (_, index) => index);
const MINUTES_SECONDS = Array.from({ length: 60 }, (_, index) => index);
const pad2 = (value: number) => String(value).padStart(2, '0');

const COLUMNS: Readonly<Record<ThreeColumnPickerPart, ThreeColumnPickerColumn>> = {
  first: { ariaLabel: 'Часы продолжительности', values: HOURS, format: pad2 },
  second: { ariaLabel: 'Минуты продолжительности', values: MINUTES_SECONDS, format: pad2 },
  third: { ariaLabel: 'Секунды продолжительности', values: MINUTES_SECONDS, format: pad2 },
};

const LENS_XS = [48, 144, 240] as const;
const SEPARATORS = [{ x: 96, label: ':' }, { x: 192, label: ':' }] as const;

export interface DurationPickerProps {
  opened: boolean;
  value: number;
  onChange: (durationSeconds: number) => void;
  onClose: () => void;
  target: HTMLElement | null;
}

function durationSecondsToParts(value: number): ThreeColumnPickerParts {
  if (!Number.isInteger(value) || value < 0 || value > 86399) {
    throw new Error('DurationPicker value must be an integer from 0 to 86399 seconds');
  }
  return {
    first: Math.floor(value / 3600),
    second: Math.floor((value % 3600) / 60),
    third: value % 60,
  };
}

export function formatDurationSeconds(value: number): string {
  const { first, second, third } = durationSecondsToParts(value);
  return `${pad2(first)}:${pad2(second)}:${pad2(third)}`;
}

export function DurationPicker({ opened, value, onChange, onClose, target }: DurationPickerProps) {
  return (
    <ThreeColumnPicker
      opened={opened}
      value={durationSecondsToParts(value)}
      onChange={({ first, second, third }) => onChange(first * 3600 + second * 60 + third)}
      onClose={onClose}
      target={target}
      columns={COLUMNS}
      lensXs={LENS_XS}
      separators={SEPARATORS}
      ariaLabel="Выбор продолжительности"
      columnsClassName="ui-duration-picker__columns"
    />
  );
}
