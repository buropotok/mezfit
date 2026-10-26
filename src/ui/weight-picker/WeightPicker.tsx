import {
  TwoColumnPicker,
  type TwoColumnPickerColumn,
} from '../two-column-picker/TwoColumnPicker';
import {
  KILOGRAM_VALUES,
  FRACTION_VALUES,
  combineWeightKg,
  formatWeightFraction,
  formatWeightFractionAria,
  parseWeightKg,
} from './weightUnits';

const COLUMNS: readonly [TwoColumnPickerColumn, TwoColumnPickerColumn] = [
  {
    ariaLabel: 'Килограммы',
    values: KILOGRAM_VALUES,
    format: String,
    freeMomentum: true,
  },
  {
    ariaLabel: 'Доли килограмма',
    values: FRACTION_VALUES,
    format: formatWeightFraction,
    formatAria: formatWeightFractionAria,
  },
];

export interface WeightPickerProps {
  opened: boolean;
  value: number;
  onChange: (weightKg: number) => void;
  onClose: () => void;
  target: HTMLElement | null;
}

export function WeightPicker({ opened, value, onChange, onClose, target }: WeightPickerProps) {
  const parts = parseWeightKg(value, 'WeightPicker');

  return (
    <TwoColumnPicker
      opened={opened}
      target={target}
      value={{ left: parts.kilograms, right: parts.fraction }}
      columns={COLUMNS}
      separator=","
      ariaLabel="Выбор веса"
      onChange={({ left, right }) => onChange(combineWeightKg(left, right))}
      onClose={onClose}
    />
  );
}
