import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Button as KonstaButton } from 'konsta/react';
import { DEFAULT_WEIGHT_REPS_PICKER_MODE, type WeightRepsPickerMode } from '../../../shared/weight-reps-picker-mode';
import { Icon } from '../Icon';
import { TextInput } from '../FormControls';
import { IconButton, Text } from '../primitives';
import {
  ThreeColumnPicker,
  type ThreeColumnPickerColumn,
  type ThreeColumnPickerPart,
} from '../three-column-picker/ThreeColumnPicker';
import {
  FRACTION_VALUES,
  KILOGRAM_VALUES,
  combineWeightKg,
  formatWeightFraction,
  formatWeightFractionAria,
  parseWeightKg,
} from '../weight-picker/weightUnits';
import './weight-reps-picker.css';

const REPS_VALUES = Array.from({ length: 101 }, (_, index) => index);

type NumericField = 'reps' | 'kilograms';
type NumericDraft = { digits: string };

const FRACTION_COLUMN: ThreeColumnPickerColumn = {
  ariaLabel: 'Доли килограмма',
  values: FRACTION_VALUES,
  format: formatWeightFraction,
  formatAria: formatWeightFractionAria,
};

const WHEEL_COLUMNS: Readonly<Record<ThreeColumnPickerPart, ThreeColumnPickerColumn>> = {
  first: { ariaLabel: 'Повторения', values: REPS_VALUES, format: String },
  second: { ariaLabel: 'Килограммы', values: KILOGRAM_VALUES, format: String },
  third: FRACTION_COLUMN,
};

const LENS_XS = [80, 176, 240] as const;
const LENS_SEPARATORS = [{ x: 208, label: ',' }] as const;

export interface WeightRepsPickerValue {
  reps: number;
  weightKg: number;
}

export interface WeightRepsPickerFields {
  reps: boolean;
  weightKg: boolean;
}

export interface WeightRepsPickerProps {
  opened: boolean;
  value: WeightRepsPickerValue;
  /** Distinguish empty fields from valid numeric zero; omitted for numeric-only callers. */
  emptyFields?: WeightRepsPickerFields;
  onChange: (value: WeightRepsPickerValue, filledFields?: WeightRepsPickerFields) => void;
  onClose: () => void;
  target: HTMLElement | null;
  /** Optional controlled mode; the UI Kit still works independently without it. */
  mode?: WeightRepsPickerMode;
  onModeChange?: (mode: WeightRepsPickerMode) => void;
}

export function WeightRepsPicker(props: WeightRepsPickerProps) {
  const [localMode, setLocalMode] = useState<WeightRepsPickerMode>(DEFAULT_WEIGHT_REPS_PICKER_MODE);
  const mode = props.mode ?? localMode;
  const changeMode = (next: WeightRepsPickerMode) => {
    if (props.mode === undefined) setLocalMode(next);
    props.onModeChange?.(next);
  };
  return props.opened ? <WeightRepsPickerSession {...props} mode={mode} onModeChange={changeMode} /> : null;
}

function WeightRepsPickerSession({
  opened,
  value: initialValue,
  emptyFields,
  onChange: onCommit,
  onClose: onDismiss,
  target,
  mode,
  onModeChange,
}: WeightRepsPickerProps & { mode: WeightRepsPickerMode; onModeChange: (mode: WeightRepsPickerMode) => void }) {
  // Explicit picker-session draft: publish once on close, never on scroll.
  const [value, setValue] = useState(initialValue);
  const valueRef = useRef(initialValue);
  const closingRef = useRef(false);
  const [filled, setFilled] = useState<WeightRepsPickerFields>(() => ({
    reps: !emptyFields?.reps, weightKg: !emptyFields?.weightKg,
  }));
  const onChange = (next: WeightRepsPickerValue) => {
    const previous = valueRef.current;
    setFilled(current => ({
      reps: current.reps || next.reps !== previous.reps,
      weightKg: current.weightKg || next.weightKg !== previous.weightKg,
    }));
    valueRef.current = next;
    setValue(next);
  };
  const [editing, setEditing] = useState<NumericField | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<NumericField, NumericDraft>>>({});
  const numberInputRef = useRef<HTMLInputElement>(null);

  if (!Number.isSafeInteger(value.reps) || value.reps < 0) {
    throw new Error('WeightRepsPicker reps must be a non-negative safe integer');
  }
  const weight = parseWeightKg(value.weightKg, 'WeightRepsPicker');

  const columns = useMemo<Readonly<Record<ThreeColumnPickerPart, ThreeColumnPickerColumn>>>(() => {
    if (mode === 'numbers') return {
      first: { ariaLabel: 'Повторения', values: [value.reps], format: String },
      second: { ariaLabel: 'Килограммы', values: [weight.kilograms], format: String },
      third: FRACTION_COLUMN,
    };
    if (value.reps <= 100 && weight.kilograms <= 399) return WHEEL_COLUMNS;
    // Preserve a larger numeric value when switching into the historical wheel ranges.
    return {
      ...WHEEL_COLUMNS,
      first: value.reps > 100 ? { ...WHEEL_COLUMNS.first, values: [...REPS_VALUES, value.reps] } : WHEEL_COLUMNS.first,
      second: weight.kilograms > 399
        ? { ...WHEEL_COLUMNS.second, values: [...KILOGRAM_VALUES, weight.kilograms] }
        : WHEEL_COLUMNS.second,
    };
  }, [mode, value.reps, weight.kilograms]);

  useEffect(() => {
    valueRef.current = initialValue;
    setValue(initialValue);
    setDrafts({});
    setFilled({ reps: !emptyFields?.reps, weightKg: !emptyFields?.weightKg });
  }, [initialValue.reps, initialValue.weightKg, emptyFields?.reps, emptyFields?.weightKg]);

  const openNumberInput = (field: NumericField) => {
    // Focus in the same trusted tap: iOS WebKit will not reliably open its
    // software keyboard when focus is deferred to an effect or animation frame.
    flushSync(() => {
      setDrafts(current => current[field] ? current : {
        ...current,
        [field]: { digits: (field === 'reps' ? filled.reps : filled.weightKg)
          ? String(field === 'reps' ? value.reps : weight.kilograms) : '' },
      });
      setEditing(field);
    });
    numberInputRef.current?.focus();
    numberInputRef.current?.select();
  };

  const updateActiveDraft = (update: (draft: NumericDraft) => NumericDraft) => {
    if (!editing) return;
    setDrafts(current => {
      const draft = current[editing];
      return draft ? { ...current, [editing]: update(draft) } : current;
    });
  };

  const changeDigits = (digits: string) => {
    // type=text + inputMode=numeric keeps a native Backspace on both platforms;
    // inputMode is a keyboard hint, not a validation boundary.
    if (!/^\d*$/.test(digits)) return;
    updateActiveDraft(() => ({ digits }));
  };

  const cancelEdit = () => {
    setEditing(null);
    setDrafts({});
  };

  // Validate the whole editing session so an invalid inactive field cannot be saved.
  const validNumber = (digits: string) => /^\d+$/.test(digits) && Number.isSafeInteger(Number(digits));
  const validDigits = (!drafts.reps || validNumber(drafts.reps.digits))
    && (!drafts.kilograms || (validNumber(drafts.kilograms.digits)
      && Number.isSafeInteger(Number(drafts.kilograms.digits) * 4 + weight.fraction / 25)));
  const numericValue = (): WeightRepsPickerValue => {
    const current = valueRef.current;
    const fraction = parseWeightKg(current.weightKg, 'WeightRepsPicker').fraction;
    return {
      reps: drafts.reps ? Number(drafts.reps.digits) : current.reps,
      weightKg: drafts.kilograms ? combineWeightKg(Number(drafts.kilograms.digits), fraction) : current.weightKg,
    };
  };

  const filledFields = (): WeightRepsPickerFields => ({
    reps: filled.reps || drafts.reps !== undefined,
    weightKg: filled.weightKg || drafts.kilograms !== undefined,
  });

  const finishPicker = () => {
    if (!validDigits || closingRef.current) return;
    closingRef.current = true;
    const next = numericValue();
    const fields = filledFields();
    // Dismissal accepts the displayed PLAN/FACT even when its numbers did not change.
    // Empty numeric wheel placeholders never become recorded zero measurements.
    if (fields.reps || fields.weightKg) {
      if (emptyFields) onCommit(next, fields);
      else onCommit(next);
    }
    numberInputRef.current?.blur();
    cancelEdit();
    onDismiss();
  };

  const cancelPicker = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    numberInputRef.current?.blur();
    cancelEdit();
    onDismiss();
  };

  const toggleMode = () => {
    if (!validDigits) return;
    setFilled(filledFields());
    onChange(numericValue());
    cancelEdit();
    onModeChange(mode === 'numbers' ? 'wheels' : 'numbers');
  };

  const lensAction = (field: NumericField) => {
    const label = field === 'reps' ? 'Изменить повторения' : 'Изменить целые килограммы';
    return (
      <IconButton label={label} aria-pressed={editing === field} onClick={() => openNumberInput(field)}>
        {drafts[field] || (field === 'reps' ? filled.reps : filled.weightKg) ? (
          <span className="ui-visually-hidden" aria-live="polite">
            {drafts[field]?.digits ?? String(field === 'reps' ? value.reps : weight.kilograms)}
          </span>
        ) : <Icon name="pencil-plus" style={{ width: 50, height: 50 }} />}
      </IconButton>
    );
  };

  return (
    <ThreeColumnPicker
        key={mode}
        geometry={mode === 'wheels' ? 'compact-time' : 'standard'}
        opened={opened}
        value={{ first: value.reps, second: weight.kilograms, third: weight.fraction }}
        onChange={({ first, second, third }) => onChange({
          reps: first,
          weightKg: combineWeightKg(second, third),
        })}
        onClose={() => finishPicker()}
        target={target}
        columns={columns}
        lensXs={LENS_XS}
        separators={LENS_SEPARATORS}
        staticLens={mode === 'numbers' ? {
          first: lensAction('reps'),
          second: lensAction('kilograms'),
        } : undefined}
        staticLensValues={mode === 'numbers' ? {
          first: drafts.reps?.digits ?? (filled.reps ? String(value.reps) : undefined),
          second: drafts.kilograms?.digits ?? (filled.weightKg ? String(weight.kilograms) : undefined),
        } : undefined}
        footer={(
          <div className="ui-weight-reps-picker__footer">
            <KonstaButton small rounded inline disabled={!validDigits}
              aria-label="Режим" aria-pressed={mode === 'wheels'} onClick={toggleMode}>
              <Text variant="caption">Режим</Text>
            </KonstaButton>
          </div>
        )}
        ariaLabel="Повторения и вес"
        popoverClassName="ui-weight-reps-picker__popover"
        pickerClassName={`ui-weight-reps-picker ui-weight-reps-picker--${mode}`}
        columnsClassName="ui-weight-reps-picker__columns"
        header={editing === null ? (
          <div className="ui-weight-reps-picker__labels">
            <Text variant="footnote" tone="muted" className="ui-weight-reps-picker__label">
              Повторения
            </Text>
            <Text variant="footnote" tone="muted" className="ui-weight-reps-picker__label">
              Вес
            </Text>
          </div>
        ) : (
          <div className="ui-weight-reps-picker__native-entry">
            <TextInput
              ref={numberInputRef}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              enterKeyHint="done"
              autoComplete="off"
              textAlign="center"
              aria-label={editing === 'reps' ? 'Ввести повторения' : 'Ввести целые килограммы'}
              value={drafts[editing]?.digits ?? ''}
              onChange={event => changeDigits(event.currentTarget.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (validDigits) finishPicker();
                }
              }}
            />
            <div className="ui-weight-reps-picker__native-actions">
              <KonstaButton clear inline small rounded onClick={cancelPicker}>
                <Text variant="body">Отменить</Text>
              </KonstaButton>
              <KonstaButton inline small rounded strong disabled={!validDigits} onClick={finishPicker}>
                <Text variant="body">Сохранить</Text>
              </KonstaButton>
            </div>
          </div>
        )}
    />
  );
}
