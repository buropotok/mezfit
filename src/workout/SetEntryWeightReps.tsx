import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Button as KonstaButton, List } from 'konsta/react';
import { SET_TYPES, SET_TYPE_LABELS, type SetType } from '../../shared/set-type';
import { BadgeButton, Divider, GlassSurface, Icon, IconButton, LiquidPopover, MezfitAutosizeTextarea, MezfitBottomSheet, MezfitDialog, MezfitDialogButton, MezfitSlider, Text, WeightRepsPicker, DurationPicker, DistancePicker, WeightPicker, NumPicker, formatDurationSeconds, type LiquidPopoverItem } from '../ui';
import { createSetEntryDraft, emptySetMetrics, type SetEntryFactDraft, type SetEntryProps } from './setEntryTypes';
import { loadBrowserGlassSettings } from '../glassSettings';
import './set-entry-weight-reps.css';

type WeightRepsSetEntryProps = Extract<SetEntryProps, { mode: 'occurrence-plan' }> |
  Extract<SetEntryProps, { mode?: 'workout' }>;

const numberFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
type MetricPicker = 'weight_reps' | 'duration' | 'distance' | 'reps' | 'weight';
const validDuration = (x: number) => Number.isInteger(x) && x >= 0 && x <= 86399;
const validDistance = (x: number) => Number.isInteger(x) && x >= 0 && x <= 100999;
const validReps = (x: number) => Number.isInteger(x) && x >= 0 && x <= 999;
const validWeight = (x: number) => pickerCompatible(x, 0);
const bands = [
  ['yellow', 'Жёлтая'], ['red', 'Красная'], ['green', 'Зелёная'],
  ['blue', 'Синяя'], ['purple', 'Фиолетовая'], ['black', 'Чёрная'],
] as const;

function metricsText(weightKg: number | null, reps: number | null): string {
  if (weightKg === null && reps === null) return 'Не заполнено';
  return `${reps ?? '—'} × ${weightKg === null ? '—' : numberFormatter.format(weightKg)} кг`;
}

function pickerCompatible(weightKg: number, reps: number): boolean {
  const fraction = Math.round(weightKg * 100) % 100;
  return Number.isInteger(reps) && reps >= 0 && reps <= 100
    && weightKg >= 0 && weightKg <= 399.75 && [0, 25, 50, 75].includes(fraction)
    && Math.abs(weightKg * 100 - Math.round(weightKg * 100)) < 0.001;
}

/** Feature composition: the wheel, sheet, buttons, popover and text field are unchanged UI Kit primitives. */
export function SetEntryWeightReps(props: WeightRepsSetEntryProps) {
  const isPlan = props.mode === 'occurrence-plan';
  const glass = loadBrowserGlassSettings();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [draft, setDraft] = useState<SetEntryFactDraft>(() => {
    const initial = createSetEntryDraft(props.data);
    return !isPlan && !props.data.fact ? { ...initial, metrics: emptySetMetrics() } : initial;
  });
  const draftRef = useRef(draft);
  const dirtyRevision = useRef(0);
  const savedRevision = useRef(0);
  const queuedRevision = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [activePicker, setActivePicker] = useState<MetricPicker | null>(null);
  const [bandOpen, setBandOpen] = useState(false);
  const target = useRef<HTMLButtonElement>(null);
  const durationTarget = useRef<HTMLButtonElement>(null);
  const distanceTarget = useRef<HTMLButtonElement>(null);
  const repsTarget = useRef<HTMLButtonElement>(null);
  const weightTarget = useRef<HTMLButtonElement>(null);
  const bandTarget = useRef<HTMLButtonElement>(null);
  const [closing, setClosing] = useState(false);
  const requestCloseRef = useRef<() => void>(() => undefined);

  const change = (mutate: (current: SetEntryFactDraft) => SetEntryFactDraft) => {
    const next = mutate(draftRef.current);
    draftRef.current = next;
    setDraft(next);
    dirtyRevision.current += 1;
    setRevision(dirtyRevision.current);
    setError('');
  };

  const persist = (): Promise<void> => {
    const atRevision = dirtyRevision.current;
    if (atRevision <= Math.max(savedRevision.current, queuedRevision.current)) return queue.current;
    queuedRevision.current = atRevision;
    const snapshot = draftRef.current;
    // Serializes all auto-saves: a stale network response cannot apply a later draft first.
    queue.current = queue.current.catch(() => undefined).then(async () => {
      setSaving(true);
      if (props.mode === 'occurrence-plan') {
        await props.onPlanSave({ ...snapshot.metrics, setType: snapshot.setType ?? null });
      } else {
        await props.onSave({ ...snapshot, setLabel: null, metrics: { ...snapshot.metrics }, bands: [...snapshot.bands] });
      }
      savedRevision.current = Math.max(savedRevision.current, atRevision);
      setError('');
    }).catch(reason => {
      const message = reason instanceof Error ? reason.message : 'Не удалось сохранить подход';
      queuedRevision.current = savedRevision.current;
      setError(message);
      throw reason;
    }).finally(() => setSaving(false));
    return queue.current;
  };

  // Interaction is local-first. Changes are saved after a short pause, not on every wheel tick.
  useEffect(() => {
    if (revision === 0) return;
    const timer = window.setTimeout(() => { void persist().catch(() => undefined); }, isPlan ? 300 : 650);
    return () => window.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  const close = async () => {
    if (closing) return;
    setClosing(true);
    try {
      await persist();
      if (dirtyRevision.current !== savedRevision.current) await persist();
      setActivePicker(null);
      setBandOpen(false);
      props.onClose();
    } catch {
      setClosing(false);
    }
  };

  // Route both Telegram BackButton and the app Back action through the same
  // awaited persistence path as the visible close control.
  requestCloseRef.current = () => { void close(); };
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
  const suggestedDuration = draft.metrics.durationSeconds ?? props.data.plan?.durationSeconds ?? 0;
  const suggestedDistance = draft.metrics.distanceMeters ?? props.data.plan?.distanceMeters ?? 0;
  const suggestedStandaloneReps = draft.metrics.reps ?? props.data.plan?.reps ?? 0;
  const suggestedStandaloneWeight = draft.metrics.weightKg ?? props.data.plan?.weightKg ?? 0;
  const currentDuration = validDuration(suggestedDuration) ? suggestedDuration : 0;
  const currentDistance = validDistance(suggestedDistance) ? suggestedDistance : 0;
  const currentStandaloneReps = validReps(suggestedStandaloneReps) ? suggestedStandaloneReps : 0;
  const currentStandaloneWeight = validWeight(suggestedStandaloneWeight) ? suggestedStandaloneWeight : 0;
  const tracking = props.data.trackingType;
  const isWeightReps = tracking === 'weight_reps';
  const hasDuration = tracking !== 'weight_reps';
  const hasDistance = tracking === 'time_distance';
  const hasReps = tracking === 'time_reps';
  const hasWeight = tracking === 'time_weight';
  const metricCount = tracking === 'time' ? 1 : 2;
  const fieldIsValid = (kind: MetricPicker): boolean => {
    if (kind === 'weight_reps') return validPicker;
    if (kind === 'duration') return validDuration(suggestedDuration) || draft.metrics.durationSeconds === null;
    if (kind === 'distance') return validDistance(suggestedDistance) || draft.metrics.distanceMeters === null;
    if (kind === 'reps') return validReps(suggestedStandaloneReps) || draft.metrics.reps === null;
    return validWeight(suggestedStandaloneWeight) || draft.metrics.weightKg === null;
  };
  const needsFactSelection = isWeightReps
    ? weightFallback || repsFallback
    : (hasDuration && draft.metrics.durationSeconds === null && !validDuration(suggestedDuration))
      || (hasDistance && draft.metrics.distanceMeters === null && !validDistance(suggestedDistance))
      || (hasReps && draft.metrics.reps === null && !validReps(suggestedStandaloneReps))
      || (hasWeight && draft.metrics.weightKg === null && !validWeight(suggestedStandaloneWeight));
  const missingFact = isWeightReps
    ? draft.metrics.weightKg === null || draft.metrics.reps === null
    : (hasDuration && draft.metrics.durationSeconds === null)
      || (hasDistance && draft.metrics.distanceMeters === null)
      || (hasReps && draft.metrics.reps === null)
      || (hasWeight && draft.metrics.weightKg === null);
  const factMetrics = {
    weightKg: isWeightReps ? currentWeight : hasWeight ? currentStandaloneWeight : null,
    reps: isWeightReps ? currentReps : hasReps ? currentStandaloneReps : null,
    durationSeconds: hasDuration ? currentDuration : null,
    distanceMeters: hasDistance ? currentDistance : null,
  };
  const confirmLabel = isWeightReps
    ? metricsText(currentWeight, currentReps)
    : [hasDuration ? formatDurationSeconds(currentDuration) : null,
      hasDistance ? `${numberFormatter.format(currentDistance / 1000)} км` : null,
      hasReps ? `${currentStandaloneReps} повт.` : null,
      hasWeight ? `${numberFormatter.format(currentStandaloneWeight)} кг` : null]
      .filter(Boolean).join(' · ');
  const selectedBand = draft.bands[0] ?? null;
  const bandItems: LiquidPopoverItem[] = [
    ...bands.map(([value, label]) => ({
      id: value,
      label,
      onSelect: () => change(old => ({ ...old, bands: old.bands[0] === value ? [] : [value] })),
    })),
    { id: 'none', label: 'Без ленты', onSelect: () => change(old => ({ ...old, bands: [] })) },
  ];

  const metricTile = (kind: MetricPicker, label: string, text: string,
    trigger: RefObject<HTMLButtonElement | null>) => (
    <GlassSurface component="button" ref={trigger} wrapContent={false} shape="auto"
      preset="modalTuned" blur={glass.blur} optics={false} halo="lifted"
      className="set-entry-weight-reps__metric-tile"
      onClick={() => { if (fieldIsValid(kind) && !closing) setActivePicker(kind); }}
      aria-disabled={!fieldIsValid(kind) || closing}
      aria-label={kind === 'weight_reps' ? 'Изменить вес и повторения' : `Изменить ${label.toLowerCase()}`}>
      <Text variant="headline">{label}</Text>
      <span className="set-entry-weight-reps__metric-value">
        <Text variant="headline">{text}</Text>
        <Icon name="chevron-right" className="set-entry-weight-reps__metric-chevron" aria-hidden="true" />
      </span>
    </GlassSurface>
  );

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
            <Text variant="caption" tone="muted">{isPlan ? 'Планирование подхода' : 'Фиксация результата'}</Text>
          </div>
          <IconButton icon="x" label="Закрыть подход" disabled={closing}
            onClick={() => { void close(); }} />
        </header>
        <div className="set-entry-weight-reps__body">
          <div className="set-entry-weight-reps__exercise">
            <div className="set-entry-weight-reps__exercise-copy">
              <Text variant="body">{props.data.identity.exerciseName}</Text>
              {props.data.identity.programName ? <Text variant="footnote" tone="muted">{props.data.identity.programName}</Text> : null}
            </div>
            {!isPlan ? <LiquidPopover isOpen={bandOpen} onOpenChange={setBandOpen}
              triggerRef={bandTarget} items={bandItems} label="Фитнес-лента"
              trigger={<IconButton ref={bandTarget} label={selectedBand ? 'Изменить фитнес-ленту' : 'Выбрать фитнес-ленту'}><span className="set-entry__icon set-entry__icon--ripple" aria-hidden="true" /></IconButton>} /> : null}
            {props.onOpenHistory ? <IconButton icon="history" label="История упражнения" onClick={props.onOpenHistory} /> : null}
          </div>
          <Divider />
          <div className="set-entry-weight-reps__section-heading">
            <Text variant="footnote">Показатели подхода</Text>
            <Text variant="caption" tone="muted">{metricCount} {metricCount === 1 ? 'показатель' : 'показателя'}</Text>
          </div>
          {isWeightReps ? metricTile('weight_reps', 'Повторения × Вес',
            metricsText(draft.metrics.weightKg, draft.metrics.reps), target) : null}
          {hasDuration ? metricTile('duration', 'Время', draft.metrics.durationSeconds === null
            ? 'Не заполнено' : validDuration(draft.metrics.durationSeconds)
              ? formatDurationSeconds(draft.metrics.durationSeconds)
              : `${draft.metrics.durationSeconds} с`, durationTarget) : null}
          {hasDistance ? metricTile('distance', 'Дистанция', draft.metrics.distanceMeters === null
            ? 'Не заполнено' : `${numberFormatter.format(draft.metrics.distanceMeters / 1000)} км`, distanceTarget) : null}
          {hasReps ? metricTile('reps', 'Повторения', draft.metrics.reps === null
            ? 'Не заполнено' : String(draft.metrics.reps), repsTarget) : null}
          {hasWeight ? metricTile('weight', 'Вес', draft.metrics.weightKg === null
            ? 'Не заполнено' : `${numberFormatter.format(draft.metrics.weightKg)} кг`, weightTarget) : null}
          {!fieldIsValid(isWeightReps ? 'weight_reps' : hasDuration ? 'duration' : hasDistance ? 'distance' : hasReps ? 'reps' : 'weight')
            ? <Text variant="footnote" role="alert">{isPlan
              ? 'Плановое значение не поддерживается текущим пикером'
              : 'Существующее значение FACT не поддерживается текущим пикером'}</Text> : null}
          {needsFactSelection ? <Text variant="footnote" role="status">Значение PLAN недоступно в пикере. Выберите новый FACT вручную; PLAN не изменится.</Text> : null}
          {!isPlan && !needsFactSelection && missingFact &&
            (isWeightReps ? validPicker : (!hasDuration || fieldIsValid('duration'))
              && (!hasDistance || fieldIsValid('distance')) && (!hasReps || fieldIsValid('reps'))
              && (!hasWeight || fieldIsValid('weight')))
            ? <KonstaButton tonal small disabled={closing} onClick={() => change(old => ({
              ...old, metrics: { ...old.metrics, ...factMetrics },
            }))}><Text variant="body">Записать {confirmLabel} как факт</Text></KonstaButton> : null}
          {!isPlan && (props.data.plan || props.data.previous) ? <div className="set-entry-weight-reps__context">
            {props.data.plan?.reps !== null && props.data.plan?.reps !== undefined
              ? <Text variant="caption" className="set-entry-weight-reps__plan-context">План: {props.data.plan.reps} повт.</Text> : null}
            {props.data.previous?.metrics.reps !== null && props.data.previous?.metrics.reps !== undefined
              ? <Text variant="caption" tone="muted">Пред.: {props.data.previous.metrics.reps} повт.</Text> : null}
            {props.data.plan?.weightKg !== null && props.data.plan?.weightKg !== undefined
              ? <Text variant="caption" className="set-entry-weight-reps__plan-context">План: {numberFormatter.format(props.data.plan.weightKg)} кг</Text> : null}
            {props.data.previous?.metrics.weightKg !== null && props.data.previous?.metrics.weightKg !== undefined
              ? <Text variant="caption" tone="muted">Пред.: {numberFormatter.format(props.data.previous.metrics.weightKg)} кг</Text> : null}
          </div> : null}
          <div className="set-entry-weight-reps__section">
            <div className="set-entry-weight-reps__section-heading">
              <Text variant="footnote">Тип подхода</Text>
              <Text variant="caption" tone="muted">необязательно</Text>
            </div>
            <div className="set-entry-weight-reps__choices" role="group" aria-label="Тип подхода">
              {SET_TYPES.map((type: SetType) => <BadgeButton key={type} color="gray"
                selected={(draft.setType ?? null) === type} disabled={closing}
                onClick={() => change(old => ({ ...old, setType: old.setType === type ? null : type }))}>
                {SET_TYPE_LABELS[type]}
              </BadgeButton>)}
            </div>
          </div>
          {!isPlan ? <>
            <div className="set-entry-weight-reps__section">
              <div className="set-entry-weight-reps__section-heading">
                <Text variant="footnote">RPE: {draft.rpe ?? 0}</Text>
                <Text variant="caption" tone="muted">необязательно</Text>
              </div>
              <MezfitSlider size="small" start={0} end={10} value={draft.rpe ?? 0}
                ariaLabel="RPE" onValueChange={rpe => {
                  if (!closing) change(old => ({ ...old, rpe }));
                }} />
            </div>
            <div className="set-entry-weight-reps__section">
              <Text variant="footnote">Комментарий</Text>
              <List nested strong dividers={false}><MezfitAutosizeTextarea label="Как прошёл подход?" floatingLabel outline
                value={draft.comment ?? ''} disabled={closing} maxLength={1000}
                onChange={event => change(old => ({ ...old, comment: event.currentTarget.value || null }))} /></List>
            </div>
          </> : null}
          {props.onOpenChat ? <KonstaButton className="set-entry-weight-reps__chat" onClick={props.onOpenChat}>
            <Text variant="body">Открыть чат</Text>
          </KonstaButton> : null}
          {error ? <Text variant="footnote" role="alert">{error}</Text> : null}
          <Text variant="caption" tone="muted" className="set-entry-weight-reps__save-hint">
            {saving ? 'Сохраняем изменения…' : error ? 'Не удалось сохранить · повторите' : 'Изменения сохраняются автоматически'}
          </Text>
          {error ? <KonstaButton tonal onClick={() => { void persist().catch(() => undefined); }}>
            <Text variant="body">Повторить сохранение</Text>
          </KonstaButton> : null}
          {props.onDelete ? <KonstaButton clear className="set-entry-weight-reps__delete"
            disabled={closing} onClick={() => setDeleteOpen(true)}>
            <Text variant="body">Удалить подход</Text>
          </KonstaButton> : null}
        </div>
      </div>
    </MezfitBottomSheet>, portalHost)}
    {createPortal(<MezfitDialog opened={deleteOpen} title="Удалить подход?"
      buttons={<>
        <MezfitDialogButton onClick={() => setDeleteOpen(false)}>Отмена</MezfitDialogButton>
        <MezfitDialogButton strong tone="danger" onClick={() => {
          if (!props.onDelete) return;
          setClosing(true);
          void persist().then(props.onDelete).then(() => {
            setDeleteOpen(false);
            props.onClose();
          }).catch(reason => {
            setError(reason instanceof Error ? reason.message : 'Не удалось удалить подход');
            setDeleteOpen(false);
            setClosing(false);
          });
        }}>Удалить</MezfitDialogButton>
      </>}>
      <Text variant="body">Подход будет удалён из этой тренировки.</Text>
    </MezfitDialog>, portalHost)}
    {createPortal(<WeightRepsPicker opened={activePicker === 'weight_reps' && validPicker}
      value={{ reps: validPicker ? currentReps : 0, weightKg: validPicker ? currentWeight : 0 }}
      target={target.current} onClose={() => setActivePicker(null)}
      onChange={value => change(old => ({ ...old, metrics: { ...old.metrics, reps: value.reps, weightKg: value.weightKg } }))} />, portalHost)}
    {createPortal(<DurationPicker opened={activePicker === 'duration' && fieldIsValid('duration')}
      value={currentDuration} target={durationTarget.current} onClose={() => setActivePicker(null)}
      onChange={durationSeconds => change(old => ({ ...old, metrics: { ...old.metrics, durationSeconds } }))} />, portalHost)}
    {createPortal(<DistancePicker opened={activePicker === 'distance' && fieldIsValid('distance')}
      value={currentDistance} target={distanceTarget.current} onClose={() => setActivePicker(null)}
      onChange={distanceMeters => change(old => ({ ...old, metrics: { ...old.metrics, distanceMeters } }))} />, portalHost)}
    {createPortal(<NumPicker opened={activePicker === 'reps' && fieldIsValid('reps')}
      value={currentStandaloneReps} target={repsTarget.current} onClose={() => setActivePicker(null)}
      onChange={reps => change(old => ({ ...old, metrics: { ...old.metrics, reps } }))} />, portalHost)}
    {createPortal(<WeightPicker opened={activePicker === 'weight' && fieldIsValid('weight')}
      value={currentStandaloneWeight} target={weightTarget.current} onClose={() => setActivePicker(null)}
      onChange={weightKg => change(old => ({ ...old, metrics: { ...old.metrics, weightKg } }))} />, portalHost)}
    </>
  );
}
