import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadBrowserGlassSettings } from '../../glassSettings';
import { FloatingActionButton } from '../components';
import { Icon, type UiIconName } from '../Icon';
import { Button, IconButton, Text } from '../primitives';
import { MezfitBottomSheet } from '../konsta-mezfit';
import {
  ThreeColumnPicker,
  type ThreeColumnPickerColumn,
  type ThreeColumnPickerPart,
} from '../three-column-picker/ThreeColumnPicker';
import {
  FRACTION_VALUES,
  combineWeightKg,
  formatWeightFraction,
  formatWeightFractionAria,
  parseWeightKg,
} from '../weight-picker/weightUnits';
import './weight-reps-picker.css';

type NumericField = 'reps' | 'kilograms';

const FRACTION_COLUMN: ThreeColumnPickerColumn = {
  ariaLabel: 'Доли килограмма',
  values: FRACTION_VALUES,
  format: formatWeightFraction,
  formatAria: formatWeightFractionAria,
};

const DIGIT_KEYS: readonly { digit: string; icon: UiIconName }[] = [
  { digit: '1', icon: 'number-1' },
  { digit: '2', icon: 'number-2' },
  { digit: '3', icon: 'number-3' },
  { digit: '4', icon: 'number-4' },
  { digit: '5', icon: 'number-5' },
  { digit: '6', icon: 'number-6' },
  { digit: '7', icon: 'number-7' },
  { digit: '8', icon: 'number-8' },
  { digit: '9', icon: 'number-9' },
  { digit: '0', icon: 'number-0' },
];

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
  const [editing, setEditing] = useState<NumericField | null>(null);
  const [digits, setDigits] = useState('');
  const [hasTyped, setHasTyped] = useState(false);

  if (!Number.isInteger(value.reps) || value.reps < 0 || value.reps > 100) {
    throw new Error('WeightRepsPicker reps must be an integer from 0 to 100');
  }
  const weight = parseWeightKg(value.weightKg, 'WeightRepsPicker');
  const glass = loadBrowserGlassSettings();

  const columns = useMemo<Readonly<Record<ThreeColumnPickerPart, ThreeColumnPickerColumn>>>(() => ({
    // These parts have static lens controls: no wheel is rendered for them.
    first: { ariaLabel: 'Повторения', values: [value.reps], format: String },
    second: { ariaLabel: 'Килограммы', values: [weight.kilograms], format: String },
    third: FRACTION_COLUMN,
  }), [value.reps, weight.kilograms]);

  useEffect(() => {
    if (!opened) {
      setEditing(null);
      setDigits('');
      setHasTyped(false);
    }
  }, [opened]);

  const openNumberSheet = (field: NumericField) => {
    setEditing(field);
    setDigits(String(field === 'reps' ? value.reps : weight.kilograms));
    setHasTyped(false);
  };

  const appendDigit = (digit: string) => {
    setDigits((current) => {
      if (!hasTyped) return digit;
      if (current.length >= 3) return current;
      return current === '0' ? digit : current + digit;
    });
    setHasTyped(true);
  };

  const cancelEdit = () => {
    setEditing(null);
    setHasTyped(false);
  };

  const maxValue = editing === 'reps' ? 100 : 399;
  const validDigits = /^\d{1,3}$/.test(digits) && Number(digits) <= maxValue;
  const saveEdit = () => {
    if (!editing || !validDigits) return;
    const number = Number(digits);
    if (editing === 'reps') {
      if (number !== value.reps) onChange({ ...value, reps: number });
    } else {
      const nextWeight = combineWeightKg(number, weight.fraction);
      if (nextWeight !== value.weightKg) onChange({ ...value, weightKg: nextWeight });
    }
    cancelEdit();
  };

  const lensAction = (field: NumericField) => {
    const isEditing = editing === field;
    const label = field === 'reps' ? 'Изменить повторения' : 'Изменить целые килограммы';
    if (isEditing) {
      return (
        <span className="ui-weight-reps-picker__lens-status" role="status" aria-label={label}>
          <Icon name="letter-i" className="ui-weight-reps-picker__input-active" style={{ width: 40, height: 40 }} />
        </span>
      );
    }
    return (
      <IconButton
        label={label}
        disabled={editing !== null}
        className="ui-weight-reps-picker__lens-edit"
        onClick={() => openNumberSheet(field)}
      >
        <Icon name="pencil-plus" style={{ width: 40, height: 40 }} />
      </IconButton>
    );
  };

  const portalHost = typeof document !== 'undefined'
    ? document.getElementById('root') ?? document.body
    : null;

  return (
    <>
      <ThreeColumnPicker
        opened={opened}
        value={{ first: value.reps, second: weight.kilograms, third: weight.fraction }}
        onChange={({ third }) => onChange({
          reps: value.reps,
          weightKg: combineWeightKg(weight.kilograms, third),
        })}
        onClose={onClose}
        target={target}
        columns={columns}
        lensXs={LENS_XS}
        separators={LENS_SEPARATORS}
        staticLens={{
          first: lensAction('reps'),
          second: lensAction('kilograms'),
        }}
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
      {portalHost ? createPortal(
        <MezfitBottomSheet
          opened={opened && editing !== null}
          label={editing === 'reps' ? 'Ввод повторений' : 'Ввод килограммов'}
          lazyMount
          layer="abovePopover"
          className="ui-weight-reps-picker__number-sheet"
        >
          <div className="ui-weight-reps-picker__number-content">
            <header className="ui-weight-reps-picker__number-header">
              <button
                type="button"
                className="ui-weight-reps-picker__cancel"
                onClick={cancelEdit}
              >
                <Text variant="body">Отменить</Text>
              </button>
              <Text variant="headline">
                {editing === 'reps' ? 'Повторения' : 'Килограммы'}
              </Text>
              <Button color="blue" disabled={!validDigits} onClick={saveEdit}>
                Сохранить
              </Button>
            </header>
            <div className="ui-weight-reps-picker__number-body">
              <Text variant="title" className="ui-weight-reps-picker__number-readout">
                {digits}{editing === 'kilograms' ? ' кг' : ''}
              </Text>
              {!validDigits ? (
                <Text variant="caption" tone="muted">
                  {editing === 'reps' ? 'Допустимо от 0 до 100' : 'Допустимо от 0 до 399'}
                </Text>
              ) : null}
              <div className="ui-weight-reps-picker__number-grid" aria-label="Цифровая клавиатура">
                {DIGIT_KEYS.map(({ digit, icon }) => (
                  <div
                    key={digit}
                    className={`ui-weight-reps-picker__number-cell${digit === '0' ? ' ui-weight-reps-picker__number-cell--zero' : ''}`}
                  >
                    <FloatingActionButton
                      label={`Цифра ${digit}`}
                      icon={icon}
                      glassPreset={glass.preset}
                      glassOptics={glass.optics}
                      onClick={() => appendDigit(digit)}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </MezfitBottomSheet>,
        portalHost,
      ) : null}
    </>
  );
}
