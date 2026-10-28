import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type CSSProperties } from 'react';
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
type NumericDraft = { digits: string; hasTyped: boolean };

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
  const [drafts, setDrafts] = useState<Partial<Record<NumericField, NumericDraft>>>({});
  const [popover, setPopover] = useState<HTMLElement | null>(null);
  const [sheetGeometry, setSheetGeometry] = useState<{ height: number; bottom: number } | null>(null);

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
      setDrafts({});
    }
  }, [opened]);

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
  const saveEdit = () => {
    if (!editing || !validDigits) return;
    const next = {
      reps: drafts.reps ? Number(drafts.reps.digits) : value.reps,
      weightKg: drafts.kilograms
        ? combineWeightKg(Number(drafts.kilograms.digits), weight.fraction)
        : value.weightKg,
    };
    if (next.reps !== value.reps || next.weightKg !== value.weightKg) onChange(next);
    cancelEdit();
    onClose();
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
        opened={opened}
        value={{ first: value.reps, second: weight.kilograms, third: weight.fraction }}
        onChange={({ third }) => onChange({
          reps: value.reps,
          weightKg: combineWeightKg(weight.kilograms, third),
        })}
        onClose={onClose}
        target={target}
        columns={columns}
        popoverRef={setPopover}
        onPositioned={editing === null ? undefined : measureSheet}
        lensXs={LENS_XS}
        separators={LENS_SEPARATORS}
        staticLens={{
          first: lensAction('reps'),
          second: lensAction('kilograms'),
        }}
        staticLensValues={{
          first: drafts.reps?.digits,
          second: drafts.kilograms?.digits,
        }}
        staticLensCursors={{
          first: editing === 'reps' ? cursor : undefined,
          second: editing === 'kilograms' ? cursor : undefined,
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
