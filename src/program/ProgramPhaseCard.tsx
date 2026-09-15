import { useId, useState } from 'react';
import { ExerciseMedia } from '../ExerciseMedia';
import type { ProgramPhaseDetails, ProgramPhaseExerciseDetails, ProgramPhaseStatus } from '../api';
import { exerciseDisplayName } from '../exerciseLocalization';
import { Badge, IconButton, List, ListItem, Text } from '../ui';
import './program-phase-card.css';

function SharedIcon({ name }: { name: 'check' | 'chevron-down' }) {
  return <span className={`program-phase-card__icon program-phase-card__icon--${name}`} aria-hidden="true" />;
}

function formatExerciseCount(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${count} упражнений`;
  if (mod10 === 1) return `${count} упражнение`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} упражнения`;
  return `${count} упражнений`;
}

function formatSetCount(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${count} подходов`;
  if (mod10 === 1) return `${count} подход`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} подхода`;
  return `${count} подходов`;
}

function statusLabel(status: ProgramPhaseStatus): string {
  if (status === 'active') return 'Активная';
  if (status === 'finished') return 'Завершена';
  return 'Запланирована';
}

function formatShortDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(date);
}

function plannedPeriod(phase: ProgramPhaseDetails): string | null {
  const start = formatShortDate(phase.plannedStartDate);
  const end = formatShortDate(phase.plannedEndDate);
  if (start && end) return `${start} — ${end}`;
  return start ?? end;
}

function phaseMeta(phase: ProgramPhaseDetails): string {
  return [statusLabel(phase.status), plannedPeriod(phase), formatExerciseCount(phase.exerciseCount)]
    .filter(Boolean)
    .join(' · ');
}

function exerciseMeta(item: ProgramPhaseExerciseDetails): string {
  return [item.dayName, formatSetCount(item.setCount)].join(' · ');
}

export function ProgramPhaseCard({
  phase,
  defaultCollapsed = false,
}: {
  phase: ProgramPhaseDetails;
  defaultCollapsed?: boolean;
}) {
  const bodyId = useId();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const toggleCollapsed = () => setCollapsed((value) => !value);

  return (
    <article className="program-phase-card" data-program-phase-id={phase.id}>
      <div className="program-phase-card__header">
        <List className="program-phase-card__header-list">
          <ListItem
            className="program-phase-card__header-toggle"
            leadingShape="square"
            leading={<span className="program-phase-card__phase-index"><Text variant="headline">{phase.position + 1}</Text></span>}
            title={phase.name}
            subtitle={phaseMeta(phase)}
            trailing={<Badge color="blue">{phase.completedExerciseCount} / {phase.exerciseCount}</Badge>}
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            onClick={toggleCollapsed}
          />
        </List>
        <IconButton
          className={`program-phase-card__collapse${collapsed ? ' program-phase-card__collapse--collapsed' : ''}`}
          label={collapsed ? 'Развернуть фазу' : 'Свернуть фазу'}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={toggleCollapsed}
        >
          <SharedIcon name="chevron-down" />
        </IconButton>
      </div>

      <div id={bodyId} className="program-phase-card__body" hidden={collapsed}>
        {phase.exercises.length > 0 ? (
          <List className="program-phase-card__exercises">
            {phase.exercises.map((item) => (
              <ListItem
                key={item.programExerciseId}
                className="program-phase-card__exercise-row"
                interactive={false}
                leadingShape="square"
                leading={<ExerciseMedia exercise={item.exercise} variant="thumbnail" />}
                title={exerciseDisplayName(item.exercise)}
                subtitle={exerciseMeta(item)}
                trailing={item.completed ? (
                  <span className="program-phase-card__completed" aria-label="Выполнено">
                    <SharedIcon name="check" />
                  </span>
                ) : undefined}
              />
            ))}
          </List>
        ) : (
          <Text variant="footnote" tone="muted" className="program-phase-card__empty">В фазе пока нет упражнений</Text>
        )}

        <div className="program-phase-card__summary">
          <div
            className="program-phase-card__progress"
            role="progressbar"
            aria-label={`Выполнение фазы ${phase.name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={phase.progressPercent}
          >
            <span className="program-phase-card__progress-value" style={{ width: `${phase.progressPercent}%` }} />
          </div>
          <Text variant="caption" tone="muted">{phase.progressPercent}% выполнено</Text>
        </div>
      </div>
    </article>
  );
}
