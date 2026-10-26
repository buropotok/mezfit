import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button as KonstaButton } from 'konsta/react';
import { SET_TYPES, SET_TYPE_LABELS, type SetType } from '../../shared/set-type';
import { loadBrowserGlassSettings } from '../glassSettings';
import { Badge, Divider, DistancePicker, DurationPicker, GlassSurface, IconButton, MezfitBottomSheet,
  MezfitDialog, MezfitDialogButton, NumPicker, Text, WeightPicker } from '../ui';
import { createSetEntryDraft, type SetEntryProps, type SetMetrics } from './setEntryTypes';
import './set-entry-weight-reps.css';

type Props = Extract<SetEntryProps, { mode: 'program-plan' | 'occurrence-plan' }>;
type MetricKey = keyof SetMetrics;
type EditableMetric = Exclude<MetricKey, never>;
const LABELS: Record<EditableMetric, string> = {
  durationSeconds: 'Продолжительность',
  distanceMeters: 'Дистанция',
  reps: 'Повторения',
  weightKg: 'Вес',
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
  const [draft, setDraft] = useState(() => createSetEntryDraft(props.data));
  const draftRef = useRef(draft);
  const changed = useRef(0);
  const saved = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [closing, setClosing] = useState(false);
  const [picker, setPicker] = useState<EditableMetric | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const targets = useRef<Partial<Record<EditableMetric, HTMLButtonElement | null>>>({});
  const requestClose = useRef<() => void>(() => undefined);
  const glass = loadBrowserGlassSettings();
  const keys = FIELDS[props.data.trackingType as keyof typeof FIELDS] ?? [];

  const change = (update: (value: typeof draft) => typeof draft) => {
    const next = update(draftRef.current);
    draftRef.current = next;
    setDraft(next);
    changed.current += 1;
    setRevision(changed.current);
    setError('');
  };
  const persist = (): Promise<void> => {
    const at = changed.current;
    if (at <= saved.current) return queue.current;
    const metrics = { ...draftRef.current.metrics };
    const setType = draftRef.current.setType ?? null;
    queue.current = queue.current.catch(() => undefined).then(async () => {
      setSaving(true);
      await props.onPlanSave({ ...metrics, setType });
      saved.current = Math.max(saved.current, at);
      setError('');
    }).catch(reason => {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить план');
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
            <Text variant="caption" tone="muted">Планирование подхода</Text>
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
              aria-disabled={closing || !valid(key, draft.metrics[key] ?? 0)}
              aria-label={`Изменить ${LABELS[key].toLowerCase()}`}
              onClick={() => {
                if (!closing && valid(key, draft.metrics[key] ?? 0)) setPicker(key);
              }}>
              <Text variant="body">{LABELS[key]}</Text>
              <Text variant="headline">{display(key, draft.metrics[key])}</Text>
            </GlassSurface>
            {!valid(key, draft.metrics[key] ?? 0)
              ? <Text variant="footnote" role="alert">Существующее значение не поддерживается пикером</Text> : null}
          </div>)}
          <div className="set-entry-weight-reps__section">
            <div className="set-entry-weight-reps__section-heading">
              <Text variant="footnote">Тип подхода</Text>
              <Text variant="caption" tone="muted">необязательно</Text>
            </div>
            <div className="set-entry-weight-reps__choices" role="group" aria-label="Тип подхода">
              {SET_TYPES.map((type: SetType) => <Badge key={type} color="gray" textVariant="caption"
                selected={(draft.setType ?? null) === type} role="button" tabIndex={closing ? -1 : 0}
                aria-pressed={(draft.setType ?? null) === type} aria-disabled={closing}
                onClick={() => { if (!closing) change(old => ({
                  ...old, setType: old.setType === type ? null : type,
                })); }}
                onKeyDown={event => {
                  if (!closing && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    change(old => ({ ...old, setType: old.setType === type ? null : type }));
                  }
                }}>{SET_TYPE_LABELS[type]}</Badge>)}
            </div>
          </div>
          {props.onOpenChat ? <KonstaButton onClick={props.onOpenChat}>Открыть чат</KonstaButton> : null}
          {props.onDeleteSet ? <KonstaButton clear onClick={() => setDeleteConfirm(true)}>
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
    {props.onDeleteSet ? createPortal(<MezfitDialog opened={deleteConfirm} title="Удалить подход?"
      buttons={<><MezfitDialogButton onClick={() => setDeleteConfirm(false)}>Отмена</MezfitDialogButton>
        <MezfitDialogButton strong onClick={() => {
          void props.onDeleteSet?.().then(() => { setDeleteConfirm(false); props.onClose(); })
            .catch(reason => setError(reason instanceof Error ? reason.message : 'Не удалось удалить подход'));
        }}>Удалить</MezfitDialogButton></>}>
      <Text variant="body">Подход будет удалён только из этой тренировки.</Text>
    </MezfitDialog>, host) : null}
    {keys.map(key => createPortal(<span key={key}>
      {key === 'durationSeconds' ? <DurationPicker opened={picker === key}
        value={valid('durationSeconds', draft.metrics.durationSeconds ?? 0) ? (draft.metrics.durationSeconds ?? 0) : 0} target={targets.current[key] ?? null}
        onClose={() => setPicker(null)}
        onChange={value => change(old => ({
          ...old, metrics: { ...old.metrics, durationSeconds: value },
        }))} /> : null}
      {key === 'distanceMeters' ? <DistancePicker opened={picker === key}
        value={valid('distanceMeters', draft.metrics.distanceMeters ?? 0) ? (draft.metrics.distanceMeters ?? 0) : 0} target={targets.current[key] ?? null}
        onClose={() => setPicker(null)}
        onChange={value => change(old => ({
          ...old, metrics: { ...old.metrics, distanceMeters: value },
        }))} /> : null}
      {key === 'reps' ? <NumPicker opened={picker === key}
        value={valid('reps', draft.metrics.reps ?? 0) ? (draft.metrics.reps ?? 0) : 0} target={targets.current[key] ?? null}
        onClose={() => setPicker(null)}
        onChange={value => change(old => ({
          ...old, metrics: { ...old.metrics, reps: value },
        }))} /> : null}
      {key === 'weightKg' ? <WeightPicker opened={picker === key}
        value={valid('weightKg', draft.metrics.weightKg ?? 0) ? (draft.metrics.weightKg ?? 0) : 0} target={targets.current[key] ?? null}
        onClose={() => setPicker(null)}
        onChange={value => change(old => ({
          ...old, metrics: { ...old.metrics, weightKg: value },
        }))} /> : null}
    </span>, host))}
  </>;
}
