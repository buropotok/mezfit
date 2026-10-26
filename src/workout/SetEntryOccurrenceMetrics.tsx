import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button as KonstaButton, List } from 'konsta/react';
import { SET_TYPES, SET_TYPE_LABELS, type SetType } from '../../shared/set-type';
import { loadBrowserGlassSettings } from '../glassSettings';
import { BadgeChoice, Divider, DistancePicker, DurationPicker, IconButton, LiquidPopover,
  MezfitAutosizeTextarea, MezfitBottomSheet, MezfitDialog, MezfitDialogButton,
  MezfitSlider, NumPicker, Text, WeightPicker, type LiquidPopoverItem } from '../ui';
import { createSetEntryDraft, emptySetMetrics, type SetEntryProps, type SetMetrics } from './setEntryTypes';
import { SetEntryChatButton } from './SetEntryChatButton';
import { SetEntryMetricTile } from './SetEntryMetricTile';
import './set-entry-weight-reps.css';

type Props = Extract<SetEntryProps, { mode: 'occurrence-plan' }> |
  Extract<SetEntryProps, { mode?: 'workout' }>;
type MetricKey = keyof SetMetrics;
type EditableMetric = Exclude<MetricKey, never>;
const EDIT_LABELS: Record<EditableMetric, string> = {
  durationSeconds: 'Изменить продолжительность',
  distanceMeters: 'Изменить дистанцию',
  reps: 'Изменить повторения',
  weightKg: 'Изменить вес',
};
const FIELDS: Record<Exclude<Props['data']['trackingType'], 'weight_reps'>, EditableMetric[]> = {
  time: ['durationSeconds'],
  time_distance: ['durationSeconds', 'distanceMeters'],
  time_reps: ['durationSeconds', 'reps'],
  time_weight: ['durationSeconds', 'weightKg'],
};
const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
function valid(key: EditableMetric, value: number) {
  switch (key) {
    case 'durationSeconds': return Number.isInteger(value) && value >= 0 && value <= 86399;
    case 'distanceMeters': return Number.isInteger(value) && value >= 0 && value <= 100999;
    case 'reps': return Number.isInteger(value) && value >= 0 && value <= 999;
    case 'weightKg': return Number.isFinite(value) && value >= 0 && value <= 399.75 && Number.isInteger(value * 4);
  }
}
function display(key: EditableMetric, value: number | null) {
  if (value === null) return 'Не заполнено';
  if (key === 'durationSeconds') {
    if (!valid(key, value)) return String(value);
    const h = Math.floor(value / 3600);
    const m = Math.floor((value % 3600) / 60);
    const sec = value % 60;
    return [h, m, sec].map(n => String(n).padStart(2, '0')).join(':');
  }
  if (key === 'distanceMeters') return `${Math.floor(value / 1000)} км ${String(value % 1000).padStart(3, '0')} м`;
  if (key === 'weightKg') return `${number.format(value)} кг`;
  return String(value);
}

/** An occurrence-scoped editor for non-weight/reps PLAN metrics. Never writes program template rows. */
export function SetEntryOccurrenceMetrics(props: Props) {
  const isPlan = props.mode === 'occurrence-plan';
  const readOnly = props.mode === 'occurrence-plan' && props.readOnly === true;
  const [draft, setDraft] = useState(() => {
    const initial = createSetEntryDraft(props.data);
    if (isPlan || props.data.fact) return initial;
    // Prefill only the metrics tracked by this exercise; never copy unrelated
    // historic PLAN fields into an otherwise empty FACT.
    const metrics = emptySetMetrics();
    for (const key of FIELDS[props.data.trackingType as keyof typeof FIELDS] ?? []) {
      metrics[key] = props.data.plan?.[key] ?? null;
    }
    return { ...initial, metrics };
  });
  const initialDraftRef = useRef(draft);
  const saveInFlightRef = useRef(false);
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const draftRef = useRef(draft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [picker, setPicker] = useState<EditableMetric | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [bandOpen, setBandOpen] = useState(false);
  const bandTarget = useRef<HTMLButtonElement>(null);
  const targets = useRef<Partial<Record<EditableMetric, HTMLElement | null>>>({});
  const requestClose = useRef<() => void>(() => undefined);
  const glass = loadBrowserGlassSettings();
  const keys = FIELDS[props.data.trackingType as keyof typeof FIELDS] ?? [];
  const suggested = (key: EditableMetric) => {
    const current = draft.metrics[key];
    if (current !== null) return current;
    const planned = !isPlan ? props.data.plan?.[key] ?? 0 : 0;
    return valid(key, planned) ? planned : 0;
  };
  // A closed UI Kit picker still validates its controlled value during render.
  // Preserve unsupported historical values in the draft/label and disable edits,
  // but never pass them into a picker that cannot represent them.
  const pickerValue = (key: EditableMetric) => {
    const value = suggested(key);
    return valid(key, value) ? value : 0;
  };
  const selectedBand = draft.bands[0] ?? null;
  const inputLocked = saving || readOnly;
  const change = (update: (value: typeof draft) => typeof draft) => {
    if (saveInFlightRef.current || readOnly) return;
    const next = update(draftRef.current);
    draftRef.current = next;
    setDraft(next);
    setError('');
  };
  const bandItems: LiquidPopoverItem[] = [
    ...([['yellow', 'Жёлтая'], ['red', 'Красная'], ['green', 'Зелёная'],
      ['blue', 'Синяя'], ['purple', 'Фиолетовая'], ['black', 'Чёрная']] as const)
      .map(([id, label]) => ({
        id, label, onSelect: () => change(old => ({
          ...old, bands: old.bands[0] === id ? [] : [id],
        })),
      })),
    { id: 'none', label: 'Без ленты', onSelect: () => change(old => ({ ...old, bands: [] })) },
  ];

  // PLAN and FACT are committed only by the explicit Save action.
  const saveEntry = async () => {
    if (saveInFlightRef.current || readOnly) return;
    saveInFlightRef.current = true;
    setSaving(true);
    setError('');
    const snapshot = { ...draftRef.current, metrics: { ...draftRef.current.metrics },
      bands: [...draftRef.current.bands] };
    setPicker(null);
    setBandOpen(false);
    try {
      if (props.mode === 'occurrence-plan') {
        await props.onPlanSave({ ...snapshot.metrics, setType: snapshot.setType ?? null });
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
  const discardEntry = () => {
    if (saveInFlightRef.current) return;
    if (JSON.stringify(draftRef.current) !== JSON.stringify(initialDraftRef.current)) {
      setDiscardConfirm(true);
    } else {
      props.onClose();
    }
  };
  requestClose.current = discardEntry;
  useEffect(() => {
    const register = props.onNavigationContextChange;
    if (!props.isOpen || !register) return;
    register({
      title: `Подход ${props.data.identity.setNumber}`,
      scrollKey: `occurrence-set:${props.data.identity.sourceProgramSetId ?? props.data.identity.setNumber}`,
      onBack: () => requestClose.current(),
    });
    return () => register(null);
  }, [props.isOpen, props.onNavigationContextChange, props.data.identity.setNumber,
    props.data.identity.sourceProgramSetId]);

  const host = document.getElementById('root') ?? document.body;
  return <>
    {createPortal(<MezfitBottomSheet opened={props.isOpen}
      label={`Подход ${props.data.identity.setNumber}`} lazyMount>
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
            onClick={() => requestClose.current()} />
        </header>
        <div className="set-entry-weight-reps__body">
          <div className="set-entry-weight-reps__exercise">
            <div className="set-entry-weight-reps__exercise-copy">
              <Text variant="body">{props.data.identity.exerciseName}</Text>
              {props.data.identity.programName ? <Text variant="footnote" tone="muted">
                {props.data.identity.programName}</Text> : null}
            </div>
            {!isPlan ? <LiquidPopover isOpen={bandOpen} onOpenChange={setBandOpen}
              triggerRef={bandTarget} items={bandItems} label="Фитнес-лента"
              trigger={<IconButton ref={bandTarget}
                disabled={inputLocked} label={selectedBand ? 'Изменить фитнес-ленту' : 'Выбрать фитнес-ленту'}>
                <span className="set-entry__icon set-entry__icon--ripple" aria-hidden="true" />
              </IconButton>} /> : null}
            {props.onOpenHistory ? <IconButton icon="history" label="История упражнения"
              onClick={props.onOpenHistory} /> : null}
          </div>
          <Divider />
          <div className="set-entry-weight-reps__section-heading">
            <Text variant="footnote">Показатели подхода</Text>
            <Text variant="caption" tone="muted">{keys.length} {keys.length === 1 ? 'показатель' : 'показателя'}</Text>
          </div>
          {keys.map(key => <div key={key}>
            <SetEntryMetricTile metric={key} blur={glass.blur}
              buttonRef={node => { targets.current[key] = node; }}
              value={display(key, draft.metrics[key])}
              ariaLabel={EDIT_LABELS[key]}
              disabled={inputLocked || !valid(key, suggested(key))}
              onClick={() => {
                if (!inputLocked && valid(key, suggested(key))) setPicker(key);
              }} />
            {!valid(key, suggested(key))
              ? <Text variant="footnote" role="alert">Существующее значение не поддерживается пикером</Text> : null}
          </div>)}
          {!isPlan && (props.data.plan || props.data.previous) ? <div className="set-entry-weight-reps__context">
            {props.data.plan ? <Text variant="caption" tone="muted">
              План: {keys.map(key => display(key, props.data.plan?.[key] ?? null)).join(' · ')}
            </Text> : null}
            {props.data.previous ? <Text variant="caption" tone="muted">
              Пред.: {keys.map(key => display(key, props.data.previous?.metrics[key] ?? null)).join(' · ')}
            </Text> : null}
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
                <MezfitSlider size="small" start={0} end={10} value={draft.rpe ?? 0}
                  ariaLabel="RPE" onValueChange={value => {
                    if (!inputLocked) change(old => ({ ...old, rpe: value === 0 ? null : value }));
                  }} />
              </div>
            </div>
            <div className="set-entry-weight-reps__section">
              <div className="set-entry-weight-reps__section-heading">
                <Text variant="footnote">Комментарий</Text>
                <Text variant="caption" tone="muted">необязательно</Text>
              </div>
              <List nested strong dividers={false}>
                <MezfitAutosizeTextarea label="Как прошёл подход?" floatingLabel outline
                  value={draft.comment ?? ''} disabled={inputLocked} maxLength={1000}
                  onChange={event => change(old => ({
                    ...old, comment: event.currentTarget.value || null,
                  }))} />
              </List>
            </div>
          </> : null}
          <SetEntryChatButton onOpenChat={props.onOpenChat} saving={saving} />
          {isPlan && !readOnly && props.onDeleteSet ? <KonstaButton clear
            colors={{ textIos: 'text-red-500', textMaterial: 'text-red-500' }} onClick={() => setDeleteConfirm(true)}>
            <Text variant="body" style={{ color: 'inherit' }}>Удалить подход</Text>
          </KonstaButton> : null}
          {error ? <Text variant="footnote" role="alert">{error}</Text> : null}
        </div>
      </div>
    </MezfitBottomSheet>, host)}
    {isPlan && !readOnly && props.onDeleteSet ? createPortal(<MezfitDialog opened={deleteConfirm}
      title={<Text variant="headline">Удалить подход?</Text>}
      buttons={<><MezfitDialogButton onClick={() => setDeleteConfirm(false)}><Text variant="body">Отмена</Text></MezfitDialogButton>
        <MezfitDialogButton strong tone="danger" onClick={() => {
          void props.onDeleteSet?.().then(() => { setDeleteConfirm(false); props.onClose(); })
            .catch(reason => setError(reason instanceof Error ? reason.message : 'Не удалось удалить подход'));
        }}><Text variant="body" style={{ color: 'inherit' }}>Удалить</Text></MezfitDialogButton></>}>
      <Text variant="body">Подход будет удалён только из этой тренировки.</Text>
    </MezfitDialog>, host) : null}
    {createPortal(<MezfitDialog opened={discardConfirm} role="alertdialog" aria-label="Изменения не сохранятся!" aria-modal="true"
      title={<Text variant="headline">Изменения не сохранятся!</Text>}
      buttons={<>
        <MezfitDialogButton onClick={() => setDiscardConfirm(false)}><Text variant="body">Отмена</Text></MezfitDialogButton>
        <MezfitDialogButton strong onClick={() => {
          setDiscardConfirm(false);
          setPicker(null);
          setBandOpen(false);
          props.onClose();
        }}><Text variant="body">Продолжить</Text></MezfitDialogButton>
      </>}>
      <Text variant="body">Выйти без сохранения введённых данных?</Text>
    </MezfitDialog>, host)}
    {keys.map(key => createPortal(<>
      {key === 'durationSeconds' ? <DurationPicker opened={picker === key}
        value={pickerValue('durationSeconds')} target={targets.current[key] ?? null}
        onClose={() => setPicker(null)}
        onChange={value => change(old => ({
          ...old, metrics: { ...old.metrics, durationSeconds: value },
        }))} /> : null}
      {key === 'distanceMeters' ? <DistancePicker opened={picker === key}
        value={pickerValue('distanceMeters')} target={targets.current[key] ?? null}
        onClose={() => setPicker(null)}
        onChange={value => change(old => ({
          ...old, metrics: { ...old.metrics, distanceMeters: value },
        }))} /> : null}
      {key === 'reps' ? <NumPicker opened={picker === key}
        value={pickerValue('reps')} target={targets.current[key] ?? null}
        onClose={() => setPicker(null)}
        onChange={value => change(old => ({
          ...old, metrics: { ...old.metrics, reps: value },
        }))} /> : null}
      {key === 'weightKg' ? <WeightPicker opened={picker === key}
        value={pickerValue('weightKg')} target={targets.current[key] ?? null}
        onClose={() => setPicker(null)}
        onChange={value => change(old => ({
          ...old, metrics: { ...old.metrics, weightKg: value },
        }))} /> : null}
    </>, host, key))}
  </>;
}
