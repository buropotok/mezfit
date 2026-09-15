import { useId, useState, type ReactNode } from 'react';
import type { ExerciseCategoryCode, ExerciseEquipmentCode, TrackingType } from '../api';
import { ExerciseMedia } from '../ExerciseMedia';
import { exerciseDisplayName } from '../exerciseLocalization';
import { Badge, IconButton, List, ListItem, Text } from '../ui';
import { SetEntry } from './SetEntry';
import type { SetMetrics } from './setEntryTypes';
import type { SessionExerciseProps, SessionExerciseSetData } from './sessionExerciseTypes';
import './session-exercise.css';

const numberFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const distanceFormatter = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const categoryLabels: Record<ExerciseCategoryCode, string> = {
  chest: 'Грудь',
  arms: 'Руки',
  back: 'Спина',
  legs: 'Ноги',
  shoulders: 'Плечи',
  core: 'Корпус',
  full_body: 'Фулбоди',
  cardio: 'Кардио',
  other: 'Другое',
};

const equipmentLabels: Record<ExerciseEquipmentCode, string> = {
  bodyweight: 'Свой вес',
  barbell: 'Штанга',
  dumbbell_single: 'Гантель x1',
  dumbbell_pair: 'Гантели x2',
  cable: 'Трос',
  machine: 'Тренажер',
  other: 'Другое',
};

function SharedIcon({ name }: { name: 'check' | 'chevron-down' | 'chevron-right' | 'dots-vertical' }) {
  return <span className={`session-exercise__icon session-exercise__icon--${name}`} aria-hidden="true" />;
}

function formatSetCount(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${count} подходов`;
  if (mod10 === 1) return `${count} подход`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} подхода`;
  return `${count} подходов`;
}

function formatDuration(value: number | null): string | null {
  if (value === null) return null;
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatWeight(value: number | null): string | null {
  return value === null ? null : `${numberFormatter.format(value)} кг`;
}

function formatReps(value: number | null): string | null {
  return value === null ? null : `${numberFormatter.format(value)} повт.`;
}

function formatDistance(value: number | null): string | null {
  return value === null ? null : `${distanceFormatter.format(value / 1000)} км`;
}

function joinMetrics(parts: Array<string | null>, separator = ' · '): string | null {
  const present = parts.filter((part): part is string => Boolean(part));
  return present.length > 0 ? present.join(separator) : null;
}

export function formatSessionSetMetrics(metrics: SetMetrics | null, trackingType: TrackingType): string | null {
  if (!metrics) return null;
  const weight = formatWeight(metrics.weightKg);
  const reps = formatReps(metrics.reps);
  const duration = formatDuration(metrics.durationSeconds);
  const distance = formatDistance(metrics.distanceMeters);

  switch (trackingType) {
    case 'weight_reps':
      return weight && reps ? `${weight} × ${numberFormatter.format(metrics.reps ?? 0)}` : weight ?? reps;
    case 'time':
      return duration;
    case 'time_distance':
      return joinMetrics([duration, distance]);
    case 'time_reps':
      return joinMetrics([duration, reps]);
    case 'time_weight':
      return joinMetrics([duration, weight]);
  }
}

function exerciseMeta(data: SessionExerciseProps['data']): string {
  const parts: string[] = [];
  if (data.exercise.category_code) parts.push(categoryLabels[data.exercise.category_code]);
  if (data.exercise.equipment_code) parts.push(equipmentLabels[data.exercise.equipment_code]);
  parts.push(formatSetCount(data.sets.length));
  return parts.join(' · ');
}

function SetStatus({ set }: { set: SessionExerciseSetData }) {
  if (set.status === 'completed') {
    return <span className="session-exercise__set-status session-exercise__set-status--completed"><SharedIcon name="check" /></span>;
  }
  return <span className="session-exercise__set-status">{set.position + 1}</span>;
}

function setSubtitle(set: SessionExerciseSetData, trackingType: TrackingType): ReactNode | undefined {
  const plan = formatSessionSetMetrics(set.plan, trackingType);
  const previous = formatSessionSetMetrics(set.previous?.metrics ?? null, trackingType);
  if (!plan && !previous) return undefined;

  return (
    <span className="session-exercise__set-context">
      {plan ? <Text variant="caption" className="session-exercise__set-plan">План: {plan}</Text> : null}
      {previous ? <Text variant="caption" tone="muted">Пред.: {previous}</Text> : null}
    </span>
  );
}

export function SessionExercise({
  context,
  data,
  defaultCollapsed = false,
  onSaveSet,
  onOpenExerciseMenu,
  onOpenHistory,
  onOpenChat,
}: SessionExerciseProps) {
  const bodyId = useId();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [selectedSessionSetId, setSelectedSessionSetId] = useState<number | null>(null);
  const completedSets = data.sets.filter((set) => set.status === 'completed').length;
  const totalSets = data.sets.length;
  const progress = totalSets === 0 ? 0 : Math.round((completedSets / totalSets) * 100);
  const exerciseName = exerciseDisplayName(data.exercise);
  const selectedSet = selectedSessionSetId === null
    ? null
    : data.sets.find((set) => set.sessionSetId === selectedSessionSetId) ?? null;
  const toggleCollapsed = () => setCollapsed((current) => !current);

  return (
    <article className="session-exercise" data-session-exercise-id={data.sessionExerciseId}>
      <div className="session-exercise__header">
        <List className="session-exercise__header-list">
          <ListItem
            className="session-exercise__header-toggle"
            leadingShape="square"
            leading={<ExerciseMedia exercise={data.exercise} variant="thumbnail" />}
            title={exerciseName}
            subtitle={exerciseMeta(data)}
            trailing={<Badge color="blue">{completedSets} / {totalSets}</Badge>}
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            onClick={toggleCollapsed}
          />
        </List>
        <IconButton
          className="session-exercise__menu"
          data-no-dnd
          label="Опции упражнения"
          onClick={() => onOpenExerciseMenu(data.sessionExerciseId)}
        >
          <SharedIcon name="dots-vertical" />
        </IconButton>
        <IconButton
          className={`session-exercise__collapse${collapsed ? ' session-exercise__collapse--collapsed' : ''}`}
          data-no-dnd
          label={collapsed ? 'Развернуть упражнение' : 'Свернуть упражнение'}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={toggleCollapsed}
        >
          <SharedIcon name="chevron-down" />
        </IconButton>
      </div>

      <div id={bodyId} className="session-exercise__body" data-no-dnd hidden={collapsed}>
        {data.notes ? <Text variant="footnote" tone="muted" className="session-exercise__notes">{data.notes}</Text> : null}

        <List className="session-exercise__sets">
          {data.sets.map((set) => {
            const setNumber = set.position + 1;
            const fact = formatSessionSetMetrics(set.fact?.metrics ?? null, data.exercise.tracking_type);
            return (
              <ListItem
                key={set.sessionSetId}
                className="session-exercise__set-row"
                leading={<SetStatus set={set} />}
                title={(
                  <span className="session-exercise__set-title">
                    <span>Подход {setNumber}</span>
                    <span className={`session-exercise__set-fact${fact ? '' : ' session-exercise__set-fact--empty'}`}>
                      {fact ?? 'ввести факт'}
                    </span>
                  </span>
                )}
                subtitle={setSubtitle(set, data.exercise.tracking_type)}
                trailing={(
                  <span className="session-exercise__set-trailing">
                    {set.fact?.rpe !== null && set.fact?.rpe !== undefined ? <Badge color="gray">RPE {set.fact.rpe}</Badge> : null}
                    <SharedIcon name="chevron-right" />
                  </span>
                )}
                aria-label={`Открыть подход ${setNumber}`}
                onClick={() => setSelectedSessionSetId(set.sessionSetId)}
              />
            );
          })}
        </List>

        <div className="session-exercise__summary">
          <div
            className="session-exercise__progress"
            role="progressbar"
            aria-label="Выполнение упражнения"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <span className="session-exercise__progress-value" style={{ width: `${progress}%` }} />
          </div>
          <Text variant="caption" tone="muted">{progress}% выполнено</Text>
        </div>
      </div>

      {selectedSet ? (
        <SetEntry
          isOpen
          data={{
            identity: {
              programId: context.program?.id ?? null,
              programName: context.program?.name ?? null,
              exerciseDefinitionId: data.exercise.id,
              exerciseName,
              setNumber: selectedSet.position + 1,
              workoutDate: context.workoutDate,
              sourceProgramSetId: selectedSet.sourceProgramSetId,
              sessionSetId: selectedSet.sessionSetId,
            },
            trackingType: data.exercise.tracking_type,
            plan: selectedSet.plan,
            previous: selectedSet.previous,
            fact: selectedSet.fact,
          }}
          onClose={() => setSelectedSessionSetId(null)}
          onSave={(fact) => onSaveSet({
            workoutSessionId: context.workoutSessionId,
            sessionExerciseId: data.sessionExerciseId,
            sessionSetId: selectedSet.sessionSetId,
            fact,
          })}
          onOpenHistory={() => onOpenHistory(data.exercise.id)}
          onOpenChat={onOpenChat}
        />
      ) : null}
    </article>
  );
}
