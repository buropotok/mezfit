import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button as KonstaButton, List } from 'konsta/react';
import { SET_TYPES, SET_TYPE_LABELS, type SetType } from '../../shared/set-type';
import { Divider, GlassSurface, IconButton, LiquidPopover, MezfitAutosizeTextarea, MezfitBottomSheet, Text, WeightRepsPicker, type LiquidPopoverItem } from '../ui';
import { createSetEntryDraft, emptySetMetrics, type SetEntryFactDraft, type SetEntryProps } from './setEntryTypes';
import './set-entry-weight-reps.css';

type WeightRepsSetEntryProps = Extract<SetEntryProps, { mode: 'program-plan' }> |
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
  const fraction = Math.round(weightKg * 100) % 100;
  return Number.isInteger(reps) && reps >= 0 && reps <= 100
    && weightKg >= 0 && weightKg <= 399.5 && [0, 25, 50].includes(fraction)
    && Math.abs(weightKg * 100 - Math.round(weightKg * 100)) < 0.001;
}

/** Feature composition: the wheel, sheet, buttons, popover and text field are unchanged UI Kit primitives. */
export function SetEntryWeightReps(props: WeightRepsSetEntryProps) {
  const isPlan = props.mode === 'program-plan';
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
  const [pickerOpened, setPickerOpened] = useState(false);
  const [bandOpen, setBandOpen] = useState(false);
  const target = useRef<HTMLButtonElement>(null);
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
      if (props.mode === 'program-plan') {
        await props.onPlanSave({
          weightKg: snapshot.metrics.weightKg,
          reps: snapshot.metrics.reps,
          setType: snapshot.setType ?? null,
        });
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
      setPickerOpened(false);
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
  const needsFactSelection = weightFallback || repsFallback;
  const selectedBand = draft.bands[0] ?? null;
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
            <Text variant="caption" tone="muted">2 показателя</Text>
          </div>
          <GlassSurface component="button" ref={target} wrapContent={false} shape="auto"
            className="set-entry-weight-reps__metric-tile"
            onClick={() => { if (validPicker && !closing) setPickerOpened(true); }}
            aria-disabled={!validPicker || closing}
            aria-label="Изменить вес и повторения">
            <Text variant="headline">Повторения × Вес</Text>
            <Text variant="headline">{metricsText(draft.metrics.weightKg, draft.metrics.reps)}</Text>
          </GlassSurface>
          {!validPicker ? <Text variant="footnote" role="alert">{isPlan
            ? 'Плановое значение не поддерживается текущим пикером'
            : 'Существующее значение FACT не поддерживается текущим пикером'}</Text> : null}
          {needsFactSelection ? <Text variant="footnote" role="status">Значение PLAN недоступно в пикере. Выберите новый FACT вручную; PLAN не изменится.</Text> : null}
          {!isPlan && validPicker && !needsFactSelection && (draft.metrics.weightKg === null || draft.metrics.reps === null)
            ? <KonstaButton tonal small disabled={closing} onClick={() => change(old => ({
              ...old, metrics: { ...old.metrics, weightKg: currentWeight, reps: currentReps },
            }))}><Text variant="body">Записать {metricsText(currentWeight, currentReps)} как факт</Text></KonstaButton> : null}
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
              {SET_TYPES.map((type: SetType) => <KonstaButton key={type} small rounded
                tonal={(draft.setType ?? null) !== type}
                aria-pressed={(draft.setType ?? null) === type}
                disabled={closing}
                onClick={() => change(old => ({ ...old, setType: old.setType === type ? null : type }))}>
                <Text variant="body">{SET_TYPE_LABELS[type]}</Text>
              </KonstaButton>)}
            </div>
          </div>
          {!isPlan ? <>
            <div className="set-entry-weight-reps__section">
              <div className="set-entry-weight-reps__section-heading">
                <Text variant="footnote">RPE</Text>
                <Text variant="caption" tone="muted">необязательно</Text>
              </div>
              <div className="set-entry-weight-reps__rpe" role="group" aria-label="RPE">
                {Array.from({ length: 10 }, (_, index) => index + 1).map(rpe =>
                  <KonstaButton key={rpe} small rounded tonal={draft.rpe !== rpe} aria-pressed={draft.rpe === rpe}
                    disabled={closing} onClick={() => change(old => ({ ...old, rpe: old.rpe === rpe ? null : rpe }))}>
                    <Text variant="body">{rpe}</Text>
                  </KonstaButton>)}
              </div>
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
        </div>
      </div>
    </MezfitBottomSheet>, portalHost)}
    {createPortal(<WeightRepsPicker opened={pickerOpened && validPicker}
      value={{ reps: validPicker ? currentReps : 0, weightKg: validPicker ? currentWeight : 0 }}
      target={target.current} onClose={() => setPickerOpened(false)}
      onChange={value => change(old => ({ ...old, metrics: { ...old.metrics, reps: value.reps, weightKg: value.weightKg } }))} />, portalHost)}
    </>
  );
}
