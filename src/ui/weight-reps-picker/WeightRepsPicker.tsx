import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
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
  KILOGRAM_VALUES,
  combineWeightKg,
  formatWeightFraction,
  formatWeightFractionAria,
  parseWeightKg,
} from '../weight-picker/weightUnits';
import './weight-reps-picker.css';

type PickerMode = 'numbers' | 'wheels';
const REPS_VALUES = Array.from({ length: 101 }, (_, index) => index);

type NumericField = 'reps' | 'kilograms';
type NumericDraft = { digits: string; hasTyped: boolean };

const FRACTION_COLUMN: ThreeColumnPickerColumn = {
  ariaLabel: 'Доли килограмма',
  values: FRACTION_VALUES,
  format: formatWeightFraction,
  formatAria: formatWeightFractionAria,
};

const WHEEL_COLUMNS: Readonly<Record<ThreeColumnPickerPart, ThreeColumnPickerColumn>> = {
  first: { ariaLabel: 'Повторения', values: REPS_VALUES, format: String, freeMomentum: true },
  second: { ariaLabel: 'Килограммы', values: KILOGRAM_VALUES, format: String, freeMomentum: true, relativeFlickStep: 10 },
  third: FRACTION_COLUMN,
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

export function WeightRepsPicker(props: WeightRepsPickerProps) {
  const [mode, setMode] = useState<PickerMode>('numbers');
  return props.opened ? <WeightRepsPickerSession {...props} mode={mode} onModeChange={setMode} /> : null;
}

function WeightRepsPickerSession({
  opened,
  value: initialValue,
  onChange: onCommit,
  onClose: onDismiss,
  target,
  mode,
  onModeChange,
}: WeightRepsPickerProps & { mode: PickerMode; onModeChange: (mode: PickerMode) => void }) {
  // Explicit picker-session draft: publish once on close, never on scroll.
  const [value, setValue] = useState(initialValue);
  const valueRef = useRef(initialValue);
  const closingRef = useRef(false);
  const onChange = (next: WeightRepsPickerValue) => {
    valueRef.current = next;
    setValue(next);
  };
  const [editing, setEditing] = useState<NumericField | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<NumericField, NumericDraft>>>({});
  const [popover, setPopover] = useState<HTMLElement | null>(null);
  const [sheetGeometry, setSheetGeometry] = useState<{ height: number; bottom: number } | null>(null);

  if (!Number.isSafeInteger(value.reps) || value.reps < 0) {
    throw new Error('WeightRepsPicker reps must be a non-negative safe integer');
  }
  const weight = parseWeightKg(value.weightKg, 'WeightRepsPicker');
  const glass = loadBrowserGlassSettings();

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
        ? { ...WHEEL_COLUMNS.second, values: [...KILOGRAM_VALUES, weight.kilograms], relativeFlickStep: undefined }
        : WHEEL_COLUMNS.second,
    };
  }, [mode, value.reps, weight.kilograms]);

  useEffect(() => {
    valueRef.current = initialValue;
    setValue(initialValue);
    setDrafts({});
  }, [initialValue.reps, initialValue.weightKg]);

  const measureSheet = useCallback(() => {
    if (!popover) return;
    const view = popover.ownerDocument.defaultView ?? window;
    const viewport = view.visualViewport;
    const bottom = viewport ? viewport.offsetTop + viewport.height : view.innerHeight;
    const top = popover.getBoundingClientRect().bottom + 10;
    const next = {
      height: Math.max(0, Math.floor(bottom - top)),
      bottom: Math.max(0, view.innerHeight - bottom),
    };
    setSheetGeometry(current => current?.height === next.height && current.bottom === next.bottom ? current : next);
  }, [popover]);

  useLayoutEffect(() => {
    if (!opened || editing === null || !popover) return;
    const view = popover.ownerDocument.defaultView ?? window;
    const viewport = view.visualViewport;
    measureSheet();
    view.addEventListener('resize', measureSheet);
    viewport?.addEventListener('resize', measureSheet);
    viewport?.addEventListener('scroll', measureSheet);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measureSheet) : null;
    observer?.observe(popover);
    return () => {
      view.removeEventListener('resize', measureSheet);
      viewport?.removeEventListener('resize', measureSheet);
      viewport?.removeEventListener('scroll', measureSheet);
      observer?.disconnect();
    };
  }, [opened, editing, popover, measureSheet]);

  const openNumberSheet = (field: NumericField) => {
    setDrafts(current => current[field] ? current : {
      ...current,
      [field]: { digits: String(field === 'reps' ? value.reps : weight.kilograms), hasTyped: false },
    });
    setEditing(field);
  };

  const updateActiveDraft = (update: (draft: NumericDraft) => NumericDraft) => {
    if (!editing) return;
    setDrafts(current => {
      const draft = current[editing];
      return draft ? { ...current, [editing]: update(draft) } : current;
    });
  };

  const appendDigit = (digit: string) => {
    updateActiveDraft(draft => ({
      digits: !draft.hasTyped || draft.digits === '0' ? digit : draft.digits + digit,
      hasTyped: true,
    }));
  };

  const clearDigits = () => updateActiveDraft(() => ({ digits: '', hasTyped: true }));
  const backspaceDigit = () => updateActiveDraft(draft => ({
    digits: draft.digits.slice(0, -1), hasTyped: true,
  }));

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

  const finishPicker = () => {
    if (!validDigits || closingRef.current) return;
    closingRef.current = true;
    const next = numericValue();
    if (next.reps !== initialValue.reps || next.weightKg !== initialValue.weightKg) onCommit(next);
    cancelEdit();
    onDismiss();
  };

  const saveEdit = () => {
    if (!editing || !validDigits) return;
    finishPicker();
  };

  const toggleMode = () => {
    if (!validDigits) return;
    onChange(numericValue());
    cancelEdit();
    onModeChange(mode === 'numbers' ? 'wheels' : 'numbers');
  };

  const lensAction = (field: NumericField) => {
    const label = field === 'reps' ? 'Изменить повторения' : 'Изменить целые килограммы';
    return (
      <IconButton label={label} aria-pressed={editing === field} onClick={() => openNumberSheet(field)}>
        {drafts[field] ? (
          <span className="ui-visually-hidden" aria-live="polite">{drafts[field]?.digits}</span>
        ) : (
          <Icon name="pencil-plus" style={{ width: 50, height: 50 }} />
        )}
      </IconButton>
    );
  };

  const cursor = <Icon name="letter-i" className="ui-weight-reps-picker__input-active" style={{ width: '100%', height: '100%' }} />;

  const portalHost = typeof document !== 'undefined'
    ? document.getElementById('root') ?? document.body
    : null;

  return (
    <>
      <ThreeColumnPicker
        key={mode}
        opened={opened}
        value={{ first: value.reps, second: weight.kilograms, third: weight.fraction }}
        onChange={({ first, second, third }) => onChange({
          reps: first,
          weightKg: combineWeightKg(second, third),
        })}
        onClose={finishPicker}
        target={target}
        columns={columns}
        popoverRef={setPopover}
        onPositioned={editing === null ? undefined : measureSheet}
        lensXs={LENS_XS}
        separators={LENS_SEPARATORS}
        staticLens={mode === 'numbers' ? {
          first: lensAction('reps'),
          second: lensAction('kilograms'),
        } : undefined}
        staticLensValues={mode === 'numbers' ? {
          first: drafts.reps?.digits,
          second: drafts.kilograms?.digits,
        } : undefined}
        staticLensCursors={mode === 'numbers' ? {
          first: editing === 'reps' ? cursor : undefined,
          second: editing === 'kilograms' ? cursor : undefined,
        } : undefined}
        footer={(
          <div className="ui-weight-reps-picker__footer">
            <KonstaButton small rounded strong inline disabled={!validDigits}
              aria-label="Режим" aria-pressed={mode === 'wheels'} onClick={toggleMode}>
              <Text variant="caption">Режим</Text>
            </KonstaButton>
          </div>
        )}
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
          contentClassName="ui-weight-reps-picker__sheet-content"
          style={sheetGeometry === null ? undefined : {
            '--ui-weight-reps-number-sheet-height': `${sheetGeometry.height}px`,
            bottom: `${sheetGeometry.bottom}px`,
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
              <div className="ui-weight-reps-picker__number-grid-area">
                <div className="ui-weight-reps-picker__number-grid" aria-label="Цифровая клавиатура">
                  {DIGIT_KEYS.map(({ digit, icon }) => (
                    <div key={digit} className="ui-weight-reps-picker__number-cell">
                      <div className="ui-weight-reps-picker__key-dock">
                        <FloatingActionButton
                          label={`Цифра ${digit}`}
                          icon={icon}
                          glassPreset={glass.preset}
                          glassOptics={glass.optics}
                          onClick={() => appendDigit(digit)}
                        />
                      </div>
                    </div>
                  ))}
                  <div className="ui-weight-reps-picker__number-cell">
                    <div className="ui-weight-reps-picker__key-dock">
                      <FloatingActionButton label="Очистить ввод" icon="x"
                        glassPreset={glass.preset} glassOptics={glass.optics}
                        onClick={clearDigits} />
                    </div>
                  </div>
                  <div className="ui-weight-reps-picker__number-cell ui-weight-reps-picker__number-cell--zero">
                    <div className="ui-weight-reps-picker__key-dock">
                      <FloatingActionButton label="Цифра 0" icon="number-0"
                        glassPreset={glass.preset} glassOptics={glass.optics}
                        onClick={() => appendDigit('0')} />
                    </div>
                  </div>
                  <div className="ui-weight-reps-picker__number-cell">
                    <div className="ui-weight-reps-picker__key-dock">
                      <FloatingActionButton label="Стереть последнюю цифру" icon="arrow-left"
                        glassPreset={glass.preset} glassOptics={glass.optics}
                        onClick={backspaceDigit} />
                    </div>
                  </div>
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
