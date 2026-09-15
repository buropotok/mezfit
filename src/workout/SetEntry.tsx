import { useId, useState } from 'react';
import { Badge, Button, Divider, IconButton, Modal, Surface, Text, TextArea, TextInput, type BadgeColor } from '../ui';
import {
  createSetEntryDraft,
  type ResistanceBandCode,
  type SetEntryFactDraft,
  type SetEntryProps,
  type SetLabel,
  type SetMetrics,
} from './setEntryTypes';
import './set-entry.css';

const numberFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const workoutDateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

const setLabelOptions: Array<{ value: SetLabel; label: string; color: BadgeColor }> = [
  { value: 'warmup', label: 'Размин', color: 'blue' },
  { value: 'easy', label: 'Легко', color: 'green' },
  { value: 'normal', label: 'Нормально', color: 'gray' },
  { value: 'hard', label: 'Тяжело', color: 'orange' },
  { value: 'drop', label: 'Дроп', color: 'purple' },
];

const bandOptions: Array<{ value: ResistanceBandCode; label: string }> = [
  { value: 'yellow', label: 'Жёлтая' },
  { value: 'red', label: 'Красная' },
  { value: 'green', label: 'Зелёная' },
  { value: 'blue', label: 'Синяя' },
  { value: 'purple', label: 'Фиолетовая' },
  { value: 'black', label: 'Чёрная' },
];

function formatWorkoutDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return workoutDateFormatter.format(date);
}

function formatNumber(value: number | null, suffix = ''): string {
  if (value === null) return '—';
  return `${numberFormatter.format(value)}${suffix}`;
}

function formatDuration(value: number | null): string {
  if (value === null) return '—';
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function parseNonNegativeNumber(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, parsed);
}

function roundTo(value: number, precision: number): number {
  const multiplier = 10 ** precision;
  return Math.round(value * multiplier) / multiplier;
}

function metersToKilometers(value: number | null): number | null {
  return value === null ? null : value / 1000;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Не удалось сохранить подход';
}

function SharedIcon({ name }: { name: 'ripple' | 'library' | 'minus' | 'plus' }) {
  return <span className={`set-entry__icon set-entry__icon--${name}`} aria-hidden="true" />;
}

// Telegram brand mark used only as the visual label for the external chat action.
function TelegramIcon() {
  return (
    <svg className="set-entry__telegram-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

type MetricFieldProps = {
  label: string;
  unit: string;
  value: number | null;
  plan: number | null;
  previous: number | null;
  step: number;
  precision: number;
  suffix: string;
  onChange: (value: number | null) => void;
};

function MetricField({ label, unit, value, plan, previous, step, precision, suffix, onChange }: MetricFieldProps) {
  const delta = value !== null && previous !== null ? roundTo(value - previous, precision) : null;

  const adjust = (direction: -1 | 1) => {
    const next = Math.max(0, (value ?? 0) + (step * direction));
    onChange(roundTo(next, precision));
  };

  return (
    <div className="set-entry__metric">
      <div className="set-entry__metric-meta">
        <Text variant="headline" className="set-entry__metric-label">{label}</Text>
        <Text variant="footnote" tone="muted">План: {formatNumber(plan, suffix)}</Text>
        <span className="set-entry__previous-line">
          <Text variant="caption" tone="muted">Предыдущая тренировка: {formatNumber(previous, suffix)}</Text>
          {delta !== null && delta !== 0 ? (
            <Text variant="caption" className={`set-entry__delta ${delta > 0 ? 'set-entry__delta--up' : 'set-entry__delta--down'}`}>
              {delta > 0 ? '↑' : '↓'} {formatNumber(Math.abs(delta))}
            </Text>
          ) : null}
        </span>
      </div>

      <div className="set-entry__metric-control">
        <TextInput
          className="set-entry__number-field"
          type="number"
          inputMode={precision === 0 ? 'numeric' : 'decimal'}
          min="0"
          step={step}
          value={value ?? ''}
          label={unit}
          placeholder=" "
          aria-label={`${label}, ${unit}`}
          onChange={(event) => onChange(parseNonNegativeNumber(event.currentTarget.value))}
        />
        <div className="set-entry__stepper">
          <IconButton className="set-entry__stepper-button" label={`Уменьшить: ${label}`} onClick={() => adjust(-1)}><SharedIcon name="minus" /></IconButton>
          <IconButton className="set-entry__stepper-button" label={`Увеличить: ${label}`} onClick={() => adjust(1)}><SharedIcon name="plus" /></IconButton>
        </div>
      </div>
    </div>
  );
}

type DurationFieldProps = {
  value: number | null;
  plan: number | null;
  previous: number | null;
  onChange: (value: number | null) => void;
};

function DurationField({ value, plan, previous, onChange }: DurationFieldProps) {
  const minutes = value === null ? '' : String(Math.floor(value / 60));
  const seconds = value === null ? '' : String(Math.floor(value % 60));

  const updatePart = (part: 'minutes' | 'seconds', rawValue: string) => {
    const currentMinutes = value === null ? 0 : Math.floor(value / 60);
    const currentSeconds = value === null ? 0 : Math.floor(value % 60);
    if (rawValue.trim() === '') {
      const remaining = part === 'minutes' ? currentSeconds : currentMinutes * 60;
      onChange(remaining === 0 ? null : remaining);
      return;
    }

    const parsed = parseNonNegativeNumber(rawValue) ?? 0;
    if (part === 'minutes') onChange(Math.floor(parsed) * 60 + currentSeconds);
    else onChange(currentMinutes * 60 + Math.min(59, Math.floor(parsed)));
  };

  const adjust = (direction: -1 | 1) => onChange(Math.max(0, (value ?? 0) + (30 * direction)));

  return (
    <div className="set-entry__metric">
      <div className="set-entry__metric-meta">
        <Text variant="headline" className="set-entry__metric-label">Время</Text>
        <Text variant="footnote" tone="muted">План: {formatDuration(plan)}</Text>
        <Text variant="caption" tone="muted">Предыдущая тренировка: {formatDuration(previous)}</Text>
      </div>

      <div className="set-entry__metric-control">
        <div className="set-entry__duration-fields">
          <TextInput
            className="set-entry__number-field"
            type="number"
            inputMode="numeric"
            min="0"
            value={minutes}
            label="МИН"
            placeholder=" "
            aria-label="Время, минуты"
            onChange={(event) => updatePart('minutes', event.currentTarget.value)}
          />
          <TextInput
            className="set-entry__number-field"
            type="number"
            inputMode="numeric"
            min="0"
            max="59"
            value={seconds}
            label="СЕК"
            placeholder=" "
            aria-label="Время, секунды"
            onChange={(event) => updatePart('seconds', event.currentTarget.value)}
          />
        </div>
        <div className="set-entry__stepper">
          <IconButton className="set-entry__stepper-button" label="Уменьшить время на 30 секунд" onClick={() => adjust(-1)}><SharedIcon name="minus" /></IconButton>
          <IconButton className="set-entry__stepper-button" label="Увеличить время на 30 секунд" onClick={() => adjust(1)}><SharedIcon name="plus" /></IconButton>
        </div>
      </div>
    </div>
  );
}

function metricValue(metrics: SetMetrics | null, key: keyof SetMetrics): number | null {
  return metrics?.[key] ?? null;
}

function setEntryIdentityKey(data: SetEntryProps['data']): string {
  return [
    data.identity.programId,
    data.identity.exerciseDefinitionId,
    data.identity.setNumber,
    data.identity.workoutDate,
    data.identity.sourceProgramSetId ?? 'extra',
  ].join(':');
}

export function SetEntry(props: SetEntryProps) {
  const lifecycleKey = `${setEntryIdentityKey(props.data)}:${props.isOpen ? 'open' : 'closed'}`;
  return <SetEntryEditor key={lifecycleKey} {...props} />;
}

function SetEntryEditor({ isOpen, data, onClose, onSave, onOpenHistory, onOpenChat }: SetEntryProps) {
  const bandsId = useId();
  const [draft, setDraft] = useState<SetEntryFactDraft>(() => createSetEntryDraft(data));
  const [bandsOpen, setBandsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const updateMetric = (key: keyof SetMetrics, value: number | null) => {
    setDraft((current) => ({
      ...current,
      metrics: { ...current.metrics, [key]: value },
    }));
  };

  const toggleBand = (band: ResistanceBandCode) => {
    setDraft((current) => ({
      ...current,
      bands: current.bands.includes(band)
        ? current.bands.filter((item) => item !== band)
        : [...current.bands, band],
    }));
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError('');
    try {
      await onSave({
        ...draft,
        metrics: { ...draft.metrics },
        bands: [...draft.bands],
      });
    } catch (error) {
      setSaveError(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const showWeight = data.trackingType === 'weight_reps' || data.trackingType === 'time_weight';
  const showReps = data.trackingType === 'weight_reps' || data.trackingType === 'time_reps';
  const showTime = data.trackingType === 'time' || data.trackingType === 'time_distance' || data.trackingType === 'time_reps' || data.trackingType === 'time_weight';
  const showDistance = data.trackingType === 'time_distance';
  const planDistanceKm = metersToKilometers(metricValue(data.plan, 'distanceMeters'));
  const previousDistanceKm = metersToKilometers(metricValue(data.previous?.metrics ?? null, 'distanceMeters'));

  return (
    <Modal
      isOpen={isOpen}
      className="set-entry-modal"
      title={`Подход ${data.identity.setNumber}`}
      closeOnBackdrop={!saving}
      onClose={onClose}
      actions={[{
        id: 'save',
        label: saving ? 'Сохраняем…' : 'Сохранить',
        disabled: saving,
        onClick: handleSave,
      }]}
    >
      <div className="set-entry">
        <div className="set-entry__header">
          <div className="set-entry__heading">
            <Text variant="headline" className="set-entry__exercise-name">{data.identity.exerciseName}</Text>
            <Text variant="footnote" tone="muted">{data.identity.programName} · {formatWorkoutDate(data.identity.workoutDate)}</Text>
          </div>

          <div className="set-entry__tools">
            <IconButton
              label="Фитнес-ленты"
              aria-expanded={bandsOpen}
              aria-controls={bandsId}
              className={draft.bands.length > 0 || bandsOpen ? 'set-entry__tool--active' : ''}
              onClick={() => setBandsOpen((open) => !open)}
            >
              <SharedIcon name="ripple" />
            </IconButton>
            <IconButton label="История упражнения" onClick={onOpenHistory}><SharedIcon name="library" /></IconButton>
          </div>

          {bandsOpen ? (
            <Surface elevated className="set-entry__bands" id={bandsId} role="dialog" aria-label="Выбор фитнес-лент">
              <div className="set-entry__bands-heading">
                <Text variant="headline">Фитнес-ленты</Text>
                <Text variant="footnote" tone="muted">{draft.bands.length > 0 ? `Выбрано: ${draft.bands.length}` : 'Можно выбрать несколько'}</Text>
              </div>
              <div className="set-entry__bands-grid" role="group" aria-label="Цвета лент">
                {bandOptions.map((band) => (
                  <button
                    key={band.value}
                    className={`set-entry__band-option set-entry__band-option--${band.value}`}
                    type="button"
                    aria-pressed={draft.bands.includes(band.value)}
                    onClick={() => toggleBand(band.value)}
                  >
                    <span className="set-entry__band-swatch" aria-hidden="true" />
                    <span>{band.label}</span>
                  </button>
                ))}
              </div>
              <div className="set-entry__bands-actions">
                <Button variant="secondary" onClick={() => setDraft((current) => ({ ...current, bands: [] }))}>Без лент</Button>
                <Button className="full-width" onClick={() => setBandsOpen(false)}>Готово</Button>
              </div>
            </Surface>
          ) : null}
        </div>

        <Divider />

        <div className="set-entry__metrics">
          {showWeight ? (
            <MetricField
              label="Вес"
              unit="КГ"
              value={draft.metrics.weightKg}
              plan={metricValue(data.plan, 'weightKg')}
              previous={metricValue(data.previous?.metrics ?? null, 'weightKg')}
              step={2.5}
              precision={1}
              suffix=" кг"
              onChange={(value) => updateMetric('weightKg', value)}
            />
          ) : null}

          {showTime ? (
            <DurationField
              value={draft.metrics.durationSeconds}
              plan={metricValue(data.plan, 'durationSeconds')}
              previous={metricValue(data.previous?.metrics ?? null, 'durationSeconds')}
              onChange={(value) => updateMetric('durationSeconds', value)}
            />
          ) : null}

          {showDistance ? (
            <MetricField
              label="Дистанция"
              unit="КМ"
              value={metersToKilometers(draft.metrics.distanceMeters)}
              plan={planDistanceKm}
              previous={previousDistanceKm}
              step={0.1}
              precision={2}
              suffix=" км"
              onChange={(value) => updateMetric('distanceMeters', value === null ? null : value * 1000)}
            />
          ) : null}

          {showReps ? (
            <MetricField
              label="Повторения"
              unit="ПОВТ."
              value={draft.metrics.reps}
              plan={metricValue(data.plan, 'reps')}
              previous={metricValue(data.previous?.metrics ?? null, 'reps')}
              step={1}
              precision={0}
              suffix=""
              onChange={(value) => updateMetric('reps', value === null ? null : Math.round(value))}
            />
          ) : null}
        </div>

        <div className="set-entry__section">
          <div className="set-entry__section-heading">
            <Text variant="footnote" className="set-entry__section-label">Оценка подхода</Text>
            <Text variant="caption" tone="muted">необязательно</Text>
          </div>
          <div className="set-entry__label-row" role="group" aria-label="Оценка подхода">
            {setLabelOptions.map((option) => (
              <button
                key={option.value}
                className="set-entry__badge-button"
                type="button"
                aria-pressed={draft.setLabel === option.value}
                onClick={() => setDraft((current) => ({ ...current, setLabel: current.setLabel === option.value ? null : option.value }))}
              >
                <Badge color={option.color}>{option.label}</Badge>
              </button>
            ))}
          </div>
        </div>

        <div className="set-entry__section">
          <div className="set-entry__section-heading">
            <Text variant="footnote" className="set-entry__section-label">RPE</Text>
            <Text variant="caption" tone="muted">необязательно</Text>
          </div>
          <div className="set-entry__rpe-row" role="group" aria-label="RPE">
            {[6, 7, 8, 9, 10].map((rpe) => (
              <Button
                key={rpe}
                variant="secondary"
                className={`set-entry__rpe-button ${draft.rpe === rpe ? 'set-entry__rpe-button--active' : ''}`}
                aria-pressed={draft.rpe === rpe}
                onClick={() => setDraft((current) => ({ ...current, rpe: current.rpe === rpe ? null : rpe }))}
              >
                {rpe}
              </Button>
            ))}
          </div>
        </div>

        <TextArea
          className="set-entry__comment"
          label="Комментарий"
          rows={3}
          value={draft.comment ?? ''}
          onChange={(event) => setDraft((current) => ({ ...current, comment: event.currentTarget.value || null }))}
        />

        <Button className="full-width set-entry__chat-button" onClick={onOpenChat}>
          <TelegramIcon />
          <span>Открыть чат</span>
        </Button>

        {saveError ? <Text variant="footnote" className="set-entry__save-error" role="alert">{saveError}</Text> : null}
      </div>
    </Modal>
  );
}
