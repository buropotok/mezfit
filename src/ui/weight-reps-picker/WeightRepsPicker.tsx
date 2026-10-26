import { Text } from '../primitives';
import {
  ThreeColumnPicker,
  type ThreeColumnPickerColumn,
  type ThreeColumnPickerPart,
} from '../three-column-picker/ThreeColumnPicker';
import {
  KILOGRAM_VALUES,
  FRACTION_VALUES,
  combineWeightKg,
  formatWeightFraction,
  formatWeightFractionAria,
  parseWeightKg,
} from '../weight-picker/weightUnits';
import './weight-reps-picker.css';

const REPS_VALUES = Array.from({ length: 101 }, (_, index) => index);

const COLUMNS: Readonly<Record<ThreeColumnPickerPart, ThreeColumnPickerColumn>> = {
  first: {
    ariaLabel: 'Повторения',
    values: REPS_VALUES,
    format: String,
    freeMomentum: true,
  },
  second: {
    ariaLabel: 'Килограммы',
    values: KILOGRAM_VALUES,
    format: String,
    freeMomentum: true,
  },
  third: {
    ariaLabel: 'Доли килограмма',
    values: FRACTION_VALUES,
    format: formatWeightFraction,
    formatAria: formatWeightFractionAria,
  },
};

const LENS_XS = [80, 176, 240] as const;
const LENS_SEPARATORS = [{ x: 208, label: ',' }] as const;

export interface WeightRepsPickerValue {
  reps: number;
  weightKg: number;
}

export interface WeightRepsPickerProps {
  opened: boolean;
  value: WeightRepsPickerValue;
  onChange: (value: WeightRepsPickerValue) => void;
  onClose: () => void;
  target: HTMLElement | null;
}

export function WeightRepsPicker({
  opened,
  value,
  onChange,
  onClose,
  target,
}: WeightRepsPickerProps) {
  if (!Number.isInteger(value.reps) || value.reps < 0 || value.reps > 100) {
    throw new Error('WeightRepsPicker reps must be an integer from 0 to 100');
  }
  const weight = parseWeightKg(value.weightKg, 'WeightRepsPicker');

  return (
    <ThreeColumnPicker
      opened={opened}
      value={{ first: value.reps, second: weight.kilograms, third: weight.fraction }}
      onChange={({ first, second, third }) => onChange({
        reps: first,
        weightKg: combineWeightKg(second, third),
      })}
      onClose={onClose}
      target={target}
      columns={COLUMNS}
      lensXs={LENS_XS}
      separators={LENS_SEPARATORS}
      ariaLabel="Повторения и вес"
      popoverClassName="ui-weight-reps-picker__popover"
      pickerClassName="ui-weight-reps-picker"
      columnsClassName="ui-weight-reps-picker__columns"
      header={(
        <div className="ui-weight-reps-picker__labels">
          <Text variant="footnote" tone="muted" className="ui-weight-reps-picker__label">
            Повторения
          </Text>
          <Text variant="footnote" tone="muted" className="ui-weight-reps-picker__label">
            Вес
          </Text>
        </div>
      )}
    />
  );
}
