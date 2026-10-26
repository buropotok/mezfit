import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button as KonstaButton, List } from 'konsta/react';
import { SET_TYPES, SET_TYPE_LABELS, type SetType } from '../../shared/set-type';
import { BadgeChoice, Divider, GlassSurface, IconButton, LiquidPopover, MezfitAutosizeTextarea, MezfitBottomSheet, MezfitDialog, MezfitDialogButton, MezfitSlider, Text, WeightRepsPicker, type LiquidPopoverItem } from '../ui';
import { loadBrowserGlassSettings } from '../glassSettings';
import { createSetEntryDraft, type SetEntryFactDraft, type SetEntryProps } from './setEntryTypes';
import { SetEntryChatButton } from './SetEntryChatButton';
import './set-entry-weight-reps.css';

type WeightRepsSetEntryProps = Extract<SetEntryProps, { mode: 'occurrence-plan' }> |
  Extract<SetEntryProps, { mode?: 'workout' }>;

const numberFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const bands = [
  ['yellow', 'Жёлтая'], ['red', 'Красная'], ['green', 'Зелёная'],
  ['blue', 'Синяя'], ['purple', 'Фиолетовая'], ['black', 'Чёрная'],
] as const;

function metricsText(weightKg: number | null, reps: number | null): string {
  if (weightKg === null && reps === null) return 'Не заполнено';
  return `${weightKg === null ? '—' : numberFormatter.format(weightKg)} кг × ${reps ?? '—'}`;
}

function pickerCompatible(weightKg: number, reps: number): boolean {
  return Number.isInteger(reps) && reps >= 0 && reps <= 100
    && Number.isFinite(weightKg) && weightKg >= 0 && weightKg <= 399.75
    && Number.isInteger(weightKg * 4);
}

/** Feature composition: the wheel, sheet, buttons, popover and text field are unchanged UI Kit primitives. */
export function SetEntryWeightReps(props: WeightRepsSetEntryProps) {
  const isPlan = props.mode === 'occurrence-plan';
  const readOnly = props.mode === 'occurrence-plan' && props.readOnly === true;
  const glass = loadBrowserGlassSettings();
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [draft, setDraft] = useState<SetEntryFactDraft>(() => createSetEntryDraft(props.data));
  const initialDraftRef = useRef(draft);
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const saveInFlightRef = useRef(false);
  const draftRef = useRef(draft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pickerOpened, setPickerOpened] = useState(false);
  const [bandOpen, setBandOpen] = useState(false);
  const target = useRef<HTMLButtonElement>(null);
  const bandTarget = useRef<HTMLButtonElement>(null);
  const requestCloseRef = useRef<() => void>(() => undefined);

  const change = (mutate: (current: SetEntryFactDraft) => SetEntryFactDraft) => {
    if (saveInFlightRef.current || readOnly) return;
    const next = mutate(draftRef.current);
    draftRef.current = next;
    setDraft(next);
    setError('');
  };

  // Neither FACT nor the scheduled PLAN is persisted until Save is tapped.
  const saveEntry = async () => {
    if (saveInFlightRef.current || readOnly) return;
    saveInFlightRef.current = true;
    setSaving(true);
    setError('');
    const snapshot = { ...draftRef.current,
      metrics: { ...draftRef.current.metrics }, bands: [...draftRef.current.bands] };
    setPickerOpened(false);
    setBandOpen(false);
    try {
      if (props.mode === 'occurrence-plan') {
        await props.onPlanSave({
          weightKg: snapshot.metrics.weightKg,
          reps: snapshot.metrics.reps,
          setType: snapshot.setType ?? null,
        });
      } else {
        await props.onSave(snapshot);
      }
      props.onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить подход');
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
    }
  };

  // X and Telegram Back discard unsaved values; warn only if anything changed.
  const discardEntry = () => {
    if (saveInFlightRef.current) return;
    if (JSON.stringify(draftRef.current) !== JSON.stringify(initialDraftRef.current)) {
      setDiscardConfirm(true);
    } else {
      props.onClose();
    }
  };
  requestCloseRef.current = discardEntry;
  useEffect(() => {
    if (!props.isOpen || !props.onNavigationContextChange) return;
    const reportNavigation = props.onNavigationContextChange;
    reportNavigation({
      title: `Подход ${props.data.identity.setNumber}`,
      scrollKey: `set-entry:${props.data.identity.sourceProgramSetId ?? props.data.identity.sessionSetId ?? props.data.identity.setNumber}`,
      onBack: () => requestCloseRef.current(),
    });
    return () => reportNavigation(null);
  }, [props.isOpen, props.onNavigationContextChange, props.data.identity.setNumber,
      props.data.identity.sourceProgramSetId, props.data.identity.sessionSetId]);

  // An unsupported PLAN must never make an empty FACT uneditable. Start the
  // picker at a supported value for the missing FACT field, without modifying
  // the original PLAN or silently rounding an existing recorded FACT.
  const suggestedWeight = draft.metrics.weightKg ?? props.data.plan?.weightKg ?? 0;
  const suggestedReps = draft.metrics.reps ?? props.data.plan?.reps ?? 0;
  const weightFallback = draft.metrics.weightKg === null && !pickerCompatible(suggestedWeight, 0);
  const repsFallback = draft.metrics.reps === null && !pickerCompatible(0, suggestedReps);
  const currentWeight = weightFallback ? 0 : suggestedWeight;
  const currentReps = repsFallback ? 0 : suggestedReps;
  const validPicker = pickerCompatible(currentWeight, currentReps);
  const needsFactSelection = weightFallback || repsFallback;
  const selectedBand = draft.bands[0] ?? null;
  const inputLocked = saving || readOnly;
  const bandItems: LiquidPopoverItem[] = [
    ...bands.map(([value, label]) => ({
      id: value,
      label,
      onSelect: () => change(old => ({ ...old, bands: old.bands[0] === value ? [] : [value] })),
    })),
    { id: 'none', label: 'Без ленты', onSelect: () => change(old => ({ ...old, bands: [] })) },
  ];

  // Both overlays must be siblings of the app surface, never descendants of
  // transformed SortableList rows or the animated sheet. Keep React context.
  const portalHost = document.getElementById('root') ?? document.body;
  return (
    <>
    {createPortal(<MezfitBottomSheet opened={props.isOpen} label={`Подход ${props.data.identity.setNumber}`} lazyMount>
      <div className="set-entry-weight-reps">
        <header className="set-entry-weight-reps__header">
          <div>
            <Text variant="headline">Подход {props.data.identity.setNumber}</Text>
            <Text variant="caption" tone="muted">{isPlan ? (readOnly ? 'План подхода' : 'Планирование подхода') : 'Фиксация результата'}</Text>
          </div>
          {!readOnly ? <KonstaButton clear small inline className="set-entry-weight-reps__save"
            disabled={saving} onClick={() => { void saveEntry(); }}>
            <Text variant="body">{saving ? 'Сохраняем…' : 'Сохранить'}</Text>
          </KonstaButton> : null}
          <IconButton icon="x" label="Закрыть подход" disabled={saving}
            onClick={() => requestCloseRef.current()} />
        </header>
        <div className="set-entry-weight-reps__body">
          <div className="set-entry-weight-reps__exercise">
            <div className="set-entry-weight-reps__exercise-copy">
              <Text variant="body">{props.data.identity.exerciseName}</Text>
              {props.data.identity.programName ? <Text variant="footnote" tone="muted">{props.data.identity.programName}</Text> : null}
            </div>
            {!isPlan ? <LiquidPopover isOpen={bandOpen} onOpenChange={setBandOpen}
              triggerRef={bandTarget} items={bandItems} label="Фитнес-лента"
              trigger={<IconButton ref={bandTarget} disabled={inputLocked} label={selectedBand ? 'Изменить фитнес-ленту' : 'Выбрать фитнес-ленту'}><span className="set-entry__icon set-entry__icon--ripple" aria-hidden="true" /></IconButton>} /> : null}
            {props.onOpenHistory ? <IconButton icon="history" label="История упражнения" onClick={props.onOpenHistory} /> : null}
          </div>
          <Divider />
          <div className="set-entry-weight-reps__section-heading">
            <Text variant="footnote">Показатели подхода</Text>
            <Text variant="caption" tone="muted">2 показателя</Text>
          </div>
          <GlassSurface component="button" ref={target} shape="auto" contentClassName="set-entry-weight-reps__metric-content" preset="modalTuned" optics={false} blur={glass.blur} halo="lifted"
            className="set-entry-weight-reps__metric-tile"
            onClick={() => { if (validPicker && !inputLocked) setPickerOpened(true); }}
            aria-disabled={!validPicker || inputLocked}
            aria-label="Изменить вес и повторения">
            <Text variant="body">Повторения × Вес</Text>
            <Text variant="body">{metricsText(draft.metrics.weightKg, draft.metrics.reps)}</Text>
          </GlassSurface>
          {!validPicker ? <Text variant="footnote" role="alert">{isPlan
            ? 'Плановое значение не поддерживается текущим пикером'
            : 'Существующее значение FACT не поддерживается текущим пикером'}</Text> : null}
          {needsFactSelection ? <Text variant="footnote" role="status">Значение PLAN недоступно в пикере. Выберите новый FACT вручную; PLAN не изменится.</Text> : null}
          {!isPlan && (props.data.plan || props.data.previous) ? <div className="set-entry-weight-reps__context">
            {props.data.plan ? <Text variant="caption" tone="muted">План: {metricsText(props.data.plan.weightKg, props.data.plan.reps)}</Text> : null}
            {props.data.previous ? <Text variant="caption" tone="muted">Пред.: {metricsText(props.data.previous.metrics.weightKg, props.data.previous.metrics.reps)}</Text> : null}
          </div> : null}
          <div className="set-entry-weight-reps__section">
            <div className="set-entry-weight-reps__section-heading">
              <Text variant="footnote">Тип подхода</Text>
              <Text variant="caption" tone="muted">необязательно</Text>
            </div>
            <div className="set-entry-weight-reps__choices" role="group" aria-label="Тип подхода">
              {SET_TYPES.map((type: SetType) => <BadgeChoice key={type} color="gray" textVariant="body" appearance="outline"
                selected={(draft.setType ?? null) === type} disabled={inputLocked}
                onClick={() => change(old => ({
                  ...old, setType: old.setType === type ? null : type,
                }))}>{SET_TYPE_LABELS[type]}</BadgeChoice>)}
            </div>
          </div>
          {!isPlan ? <>
            <div className="set-entry-weight-reps__section">
              <div className="set-entry-weight-reps__section-heading">
                <Text variant="footnote">RPE: {draft.rpe ?? 0}</Text>
                <Text variant="caption" tone="muted">необязательно</Text>
              </div>
              <div className="set-entry-weight-reps__rpe" role="group" aria-label="RPE">
                <MezfitSlider size="small" start={0} end={10} value={draft.rpe ?? 0} ariaLabel="RPE"
                  onValueChange={value => { if (!inputLocked) change(old => ({ ...old, rpe: value === 0 ? null : value })); }} />
              </div>
            </div>
            <div className="set-entry-weight-reps__section">
              <Text variant="footnote">Комментарий</Text>
              <List nested strong dividers={false}><MezfitAutosizeTextarea label="Как прошёл подход?" floatingLabel outline
                value={draft.comment ?? ''} disabled={inputLocked} maxLength={1000}
                onChange={event => change(old => ({ ...old, comment: event.currentTarget.value || null }))} /></List>
            </div>
          </> : null}
          <SetEntryChatButton onOpenChat={props.onOpenChat} saving={saving} />
          {error ? <Text variant="footnote" role="alert">{error}</Text> : null}
          {isPlan && !readOnly && props.onDeleteSet ? <KonstaButton clear
            colors={{ textIos: 'text-red-500', textMaterial: 'text-red-500' }} className="set-entry-weight-reps__delete"
            onClick={() => setDeleteConfirm(true)}><Text variant="body" style={{ color: 'inherit' }}>Удалить подход</Text></KonstaButton> : null}
        </div>
      </div>
    </MezfitBottomSheet>, portalHost)}
    {isPlan && !readOnly && props.onDeleteSet ? createPortal(<MezfitDialog opened={deleteConfirm}
      title={<Text variant="headline">Удалить подход?</Text>}
      buttons={<><MezfitDialogButton onClick={() => setDeleteConfirm(false)}><Text variant="body">Отмена</Text></MezfitDialogButton>
        <MezfitDialogButton strong tone="danger" onClick={() => {
          void props.onDeleteSet?.().then(() => { setDeleteConfirm(false); props.onClose(); })
            .catch(reason => setError(reason instanceof Error ? reason.message : 'Не удалось удалить подход'));
        }}><Text variant="body" style={{ color: 'inherit' }}>Удалить</Text></MezfitDialogButton></>}>
      <Text variant="body">Подход будет удалён только из этой тренировки.</Text>
    </MezfitDialog>, portalHost) : null}
    {createPortal(<MezfitDialog opened={discardConfirm} role="alertdialog" aria-label="Изменения не сохранятся!" aria-modal="true"
      title={<Text variant="headline">Изменения не сохранятся!</Text>}
      buttons={<>
        <MezfitDialogButton onClick={() => setDiscardConfirm(false)}><Text variant="body">Отмена</Text></MezfitDialogButton>
        <MezfitDialogButton strong onClick={() => {
          setDiscardConfirm(false);
          setPickerOpened(false);
          setBandOpen(false);
          props.onClose();
        }}><Text variant="body">Продолжить</Text></MezfitDialogButton>
      </>}>
      <Text variant="body">Выйти без сохранения введённых данных?</Text>
    </MezfitDialog>, portalHost)}
    {createPortal(<WeightRepsPicker opened={pickerOpened && validPicker && !saving}
      value={{ reps: validPicker ? currentReps : 0, weightKg: validPicker ? currentWeight : 0 }}
      target={target.current} onClose={() => setPickerOpened(false)}
      onChange={value => change(old => ({ ...old, metrics: { ...old.metrics, reps: value.reps, weightKg: value.weightKg } }))} />, portalHost)}
    </>
  );
}
