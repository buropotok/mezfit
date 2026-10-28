import { useEffect, useLayoutEffect, useMemo, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Button as KonstaButton } from 'konsta/react';
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
  const [sheetMaxHeight, setSheetMaxHeight] = useState<number | null>(null);

  if (!Number.isSafeInteger(value.reps) || value.reps < 0) {
    throw new Error('WeightRepsPicker reps must be a non-negative safe integer');
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

  // The keypad may never cover its originating picker and metric control.
  // Compute the free area from live layout rather than guessing a device height.
  useLayoutEffect(() => {
    if (!opened || editing === null) {
      setSheetMaxHeight(null);
      return;
    }
    const view = target?.ownerDocument.defaultView ?? window;
    const viewport = view.visualViewport;
    const popover = view.document.querySelector<HTMLElement>('.ui-weight-reps-picker__popover');
    const measure = () => {
      const bottom = viewport ? viewport.offsetTop + viewport.height : view.innerHeight;
      const top = Math.max(
        popover?.getBoundingClientRect().bottom ?? 0,
        target?.getBoundingClientRect().bottom ?? 0,
      ) + 12;
      setSheetMaxHeight(Math.max(0, Math.floor(bottom - top)));
    };
    measure();
    view.addEventListener('resize', measure);
    viewport?.addEventListener('resize', measure);
    viewport?.addEventListener('scroll', measure);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (popover) observer?.observe(popover);
    if (target) observer?.observe(target);
    return () => {
      view.removeEventListener('resize', measure);
      viewport?.removeEventListener('resize', measure);
      viewport?.removeEventListener('scroll', measure);
      observer?.disconnect();
    };
  }, [opened, editing, target]);

  const openNumberSheet = (field: NumericField) => {
    setEditing(field);
    setDigits(String(field === 'reps' ? value.reps : weight.kilograms));
    setHasTyped(false);
  };

  const appendDigit = (digit: string) => {
    setDigits((current) => {
      if (!hasTyped) return digit;
      return current === '0' ? digit : current + digit;
    });
    setHasTyped(true);
  };

  const clearDigits = () => {
    setDigits('');
    setHasTyped(true);
  };

  const backspaceDigit = () => {
    setDigits((current) => current.slice(0, -1));
    setHasTyped(true);
  };

  const cancelEdit = () => {
    setEditing(null);
    setHasTyped(false);
  };

  // No product-specific upper bound. Guard only against values JS cannot
  // represent exactly as integers or quarter-kilograms.
  const validDigits = /^\d+$/.test(digits)
    && Number.isSafeInteger(Number(digits))
    && (editing !== 'kilograms' || Number.isSafeInteger(Number(digits) * 4 + weight.fraction / 25));
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
    onClose();
  };

  const lensAction = (field: NumericField) => {
    const isEditing = editing === field;
    const label = field === 'reps' ? 'Изменить повторения' : 'Изменить целые килограммы';
    const displayedValue = String(field === 'reps' ? value.reps : weight.kilograms);
    return (
      <div className="ui-weight-reps-picker__lens-field">
        {isEditing ? (
          <span className="ui-weight-reps-picker__lens-status" role="status" aria-label={label}>
            <Icon name="letter-i" className="ui-weight-reps-picker__input-active" style={{ width: 40, height: 40 }} />
          </span>
        ) : (
          <IconButton
            label={label}
            disabled={editing !== null}
            onClick={() => openNumberSheet(field)}
          >
            <Icon name="pencil-plus" style={{ width: 40, height: 40 }} />
          </IconButton>
        )}
        <Text variant="caption" className="ui-weight-reps-picker__lens-value">
          {displayedValue}
        </Text>
      </div>
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
          style={sheetMaxHeight === null ? undefined : {
            '--ui-weight-reps-number-sheet-max-height': `${sheetMaxHeight}px`,
          } as CSSProperties}
        >
          <div className="ui-weight-reps-picker__number-content">
            <header className="ui-weight-reps-picker__number-header">
              <KonstaButton
                clear
                inline
                className="ui-weight-reps-picker__cancel"
                onClick={cancelEdit}
              >
                <Text variant="body">Отменить</Text>
              </KonstaButton>
              <Text variant="headline">
                {editing === 'reps' ? 'Повторения' : 'Килограммы'}
              </Text>
              <span className="ui-weight-reps-picker__save-slot">
                <Button disabled={!validDigits} onClick={saveEdit}>
                  Сохранить
                </Button>
              </span>
            </header>
            <div className="ui-weight-reps-picker__number-body">
              <div className="ui-weight-reps-picker__number-grid" aria-label="Цифровая клавиатура">
                {DIGIT_KEYS.slice(0, 9).map(({ digit, icon }) => (
                  <div
                    key={digit}
                    className="ui-weight-reps-picker__number-cell"
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
                <div className="ui-weight-reps-picker__number-cell">
                  <FloatingActionButton label="Очистить ввод" icon="x"
                    glassPreset={glass.preset} glassOptics={glass.optics}
                    onClick={clearDigits} />
                </div>
                <div className="ui-weight-reps-picker__number-cell ui-weight-reps-picker__number-cell--zero">
                  <FloatingActionButton label="Цифра 0" icon="number-0"
                    glassPreset={glass.preset} glassOptics={glass.optics}
                    onClick={() => appendDigit('0')} />
                </div>
                <div className="ui-weight-reps-picker__number-cell">
                  <FloatingActionButton label="Стереть последнюю цифру" icon="arrow-left"
                    glassPreset={glass.preset} glassOptics={glass.optics}
                    onClick={backspaceDigit} />
                </div>
              </div>
            </div>
          </div>
        </MezfitBottomSheet>,
        portalHost,
      ) : null}
    </>
  );
}
