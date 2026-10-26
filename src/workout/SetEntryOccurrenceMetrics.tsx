import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button as KonstaButton, List } from 'konsta/react';
import { SET_TYPES, SET_TYPE_LABELS, type SetType } from '../../shared/set-type';
import { loadBrowserGlassSettings } from '../glassSettings';
import { BadgeChoice, Divider, DistancePicker, DurationPicker, GlassSurface, IconButton, LiquidPopover,
  MezfitAutosizeTextarea, MezfitBottomSheet, MezfitDialog, MezfitDialogButton,
  MezfitSlider, NumPicker, Text, WeightPicker, type LiquidPopoverItem } from '../ui';
import { createSetEntryDraft, emptySetMetrics, type SetEntryProps, type SetMetrics } from './setEntryTypes';
import './set-entry-weight-reps.css';

type Props = Extract<SetEntryProps, { mode: 'occurrence-plan' }> |
  Extract<SetEntryProps, { mode?: 'workout' }>;
type MetricKey = keyof SetMetrics;
type EditableMetric = Exclude<MetricKey, never>;
const LABELS: Record<EditableMetric, string> = {
  durationSeconds: 'Продолжительность',
  distanceMeters: 'Дистанция',
  reps: 'Повторения',
  weightKg: 'Вес',
};
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
  const [draft, setDraft] = useState(() => {
    const initial = createSetEntryDraft(props.data);
    return !isPlan && !props.data.fact ? { ...initial, metrics: emptySetMetrics() } : initial;
  });
  const draftRef = useRef(draft);
  const changed = useRef(0);
  const saved = useRef(0);
  const queued = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [closing, setClosing] = useState(false);
  const [picker, setPicker] = useState<EditableMetric | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [bandOpen, setBandOpen] = useState(false);
  const bandTarget = useRef<HTMLButtonElement>(null);
  const targets = useRef<Partial<Record<EditableMetric, HTMLButtonElement | null>>>({});
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
  const change = (update: (value: typeof draft) => typeof draft) => {
    const next = update(draftRef.current);
    draftRef.current = next;
    setDraft(next);
    changed.current += 1;
    setRevision(changed.current);
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

  const persist = (): Promise<void> => {
    const at = changed.current;
    if (at <= Math.max(saved.current, queued.current)) return queue.current;
    queued.current = at;
    const snapshot = { ...draftRef.current, metrics: { ...draftRef.current.metrics },
      bands: [...draftRef.current.bands] };
    const metrics = snapshot.metrics;
    const setType = snapshot.setType ?? null;
    queue.current = queue.current.catch(() => undefined).then(async () => {
      setSaving(true);
      if (props.mode === 'occurrence-plan') {
        await props.onPlanSave({ ...metrics, setType });
      } else {
        await props.onSave({
          ...snapshot, metrics, setType, setLabel: null,
        });
      }
      saved.current = Math.max(saved.current, at);
      setError('');
    }).catch(reason => {
      queued.current = saved.current;
      setError(reason instanceof Error ? reason.message
        : isPlan ? 'Не удалось сохранить план' : 'Не удалось сохранить результат');
      throw reason;
    }).finally(() => setSaving(false));
    return queue.current;
  };
  useEffect(() => {
    if (revision === 0) return;
    const timer = window.setTimeout(() => { void persist().catch(() => undefined); }, 300);
    return () => window.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);
  const close = async () => {
    if (closing) return;
    setClosing(true);
    try {
      await persist();
      if (changed.current !== saved.current) await persist();
      setPicker(null);
      props.onClose();
    } catch { setClosing(false); }
  };
  requestClose.current = () => { void close(); };
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
            <Text variant="caption" tone="muted">{isPlan ? 'Планирование подхода' : 'Фиксация результата'}</Text>
          </div>
          <IconButton icon="x" label="Закрыть подход" disabled={closing}
            onClick={() => { void close(); }} />
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
                label={selectedBand ? 'Изменить фитнес-ленту' : 'Выбрать фитнес-ленту'}>
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
            <GlassSurface component="button" wrapContent={false} shape="auto" preset="modalTuned"
              optics={false} blur={glass.blur} halo="lifted" className="set-entry-weight-reps__metric-tile"
              ref={node => { targets.current[key] = node as HTMLButtonElement | null; }}
              aria-disabled={closing || !valid(key, suggested(key))}
              aria-label={EDIT_LABELS[key]}
              onClick={() => {
                if (!closing && valid(key, suggested(key))) setPicker(key);
              }}>
              <Text variant="body">{LABELS[key]}</Text>
              <Text variant="body">{display(key, draft.metrics[key])}</Text>
            </GlassSurface>
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
          {!isPlan && props.data.plan && keys.some(key => draft.metrics[key] === null)
            && keys.some(key => props.data.plan?.[key] !== null)
            && keys.every(key => props.data.plan?.[key] === null || valid(key, props.data.plan?.[key] ?? 0))
            ? <KonstaButton tonal small disabled={closing} onClick={() => change(old => ({
              ...old, metrics: { ...old.metrics,
                ...Object.fromEntries(keys.filter(key => old.metrics[key] === null)
                  .map(key => [key, props.data.plan?.[key] ?? null])) },
            }))}>Записать значения плана как факт</KonstaButton> : null}
          <div className="set-entry-weight-reps__section">
            <div className="set-entry-weight-reps__section-heading">
              <Text variant="footnote">Тип подхода</Text>
              <Text variant="caption" tone="muted">необязательно</Text>
            </div>
            <div className="set-entry-weight-reps__choices" role="group" aria-label="Тип подхода">
              {SET_TYPES.map((type: SetType) => <BadgeChoice key={type} color="gray"
                selected={(draft.setType ?? null) === type} disabled={closing}
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
                    if (!closing) change(old => ({ ...old, rpe: value }));
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
                  value={draft.comment ?? ''} disabled={closing} maxLength={1000}
                  onChange={event => change(old => ({
                    ...old, comment: event.currentTarget.value || null,
                  }))} />
              </List>
            </div>
          </> : null}
          {props.onOpenChat ? <KonstaButton onClick={props.onOpenChat}>Открыть чат</KonstaButton> : null}
          {isPlan && props.onDeleteSet ? <KonstaButton clear onClick={() => setDeleteConfirm(true)}>
            Удалить подход
          </KonstaButton> : null}
          {error ? <Text variant="footnote" role="alert">{error}</Text> : null}
          <Text variant="caption" tone="muted" className="set-entry-weight-reps__save-hint">
            {saving ? 'Сохраняем изменения…' : 'Изменения сохраняются автоматически'}
          </Text>
          {error ? <KonstaButton tonal onClick={() => { void persist().catch(() => undefined); }}>
            Повторить сохранение
          </KonstaButton> : null}
        </div>
      </div>
    </MezfitBottomSheet>, host)}
    {isPlan && props.onDeleteSet ? createPortal(<MezfitDialog opened={deleteConfirm} title="Удалить подход?"
      buttons={<><MezfitDialogButton onClick={() => setDeleteConfirm(false)}>Отмена</MezfitDialogButton>
        <MezfitDialogButton strong onClick={() => {
          void props.onDeleteSet?.().then(() => { setDeleteConfirm(false); props.onClose(); })
            .catch(reason => setError(reason instanceof Error ? reason.message : 'Не удалось удалить подход'));
        }}>Удалить</MezfitDialogButton></>}>
      <Text variant="body">Подход будет удалён только из этой тренировки.</Text>
    </MezfitDialog>, host) : null}
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
