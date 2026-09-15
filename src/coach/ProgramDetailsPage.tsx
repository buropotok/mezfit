import { useEffect, useMemo, useState } from 'react';
import type { ProgramStatus } from '../api';
import { ProgramPhaseCard } from '../program/ProgramPhaseCard';
import { getCoachProgramDetails, type CoachProgramDetails } from '../program/programDetailsApi';
import { Avatar, Badge, Button, List, ListItem, Surface, Text } from '../ui';
import './program-details.css';

function ownerName(details: CoachProgramDetails): string {
  return [details.owner.firstName, details.owner.lastName].filter(Boolean).join(' ');
}

function statusBadge(status: ProgramStatus) {
  if (status === 'active') return <Badge color="green">Активный</Badge>;
  if (status === 'finished') return <Badge color="blue">Завершен</Badge>;
  return <Badge color="yellow">Черновик</Badge>;
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

function period(details: CoachProgramDetails): string {
  const plannedStart = formatDate(details.plannedStartDate);
  const plannedEnd = formatDate(details.plannedEndDate);
  if (plannedStart && plannedEnd) return `${plannedStart} — ${plannedEnd}`;
  if (plannedStart) return `с ${plannedStart}`;
  if (plannedEnd) return `до ${plannedEnd}`;

  const started = formatDate(details.program.startedAt);
  const finished = formatDate(details.program.finishedAt);
  if (started && finished) return `${started} — ${finished}`;
  if (started) return `${started} — ...`;
  return 'Даты не заданы';
}

function exerciseProgressLabel(details: CoachProgramDetails): string {
  if (details.exerciseCount === 0) return 'Упражнения пока не добавлены';
  return `${details.completedExerciseCount} из ${details.exerciseCount} упражнений`;
}

export function ProgramDetailsPage({ initData, programId }: { initData: string; programId: number }) {
  const [details, setDetails] = useState<CoachProgramDetails | null>(null);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setDetails(null);
    setError('');
    getCoachProgramDetails(initData, programId)
      .then((result) => {
        if (!cancelled) setDetails(result);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить программу');
      });
    return () => { cancelled = true; };
  }, [initData, programId, reloadKey]);

  const hasActivePhase = useMemo(
    () => details?.phases.some((phase) => phase.status === 'active') ?? false,
    [details],
  );

  if (!details) {
    return (
      <section className="program-details-page" aria-label="Детали программы">
        {error ? (
          <Surface className="program-details-error">
            <Text variant="headline">Не удалось загрузить программу</Text>
            <Text variant="footnote" tone="muted">{error}</Text>
            <Button onClick={() => setReloadKey((value) => value + 1)}>Повторить</Button>
          </Surface>
        ) : <Text tone="muted">Загружаем программу…</Text>}
      </section>
    );
  }

  const name = ownerName(details);

  return (
    <section className="program-details-page" aria-label={`Программа ${details.program.name}`}>
      <div className="program-details-scroll">
        <header className="program-details-heading">
          <Text variant="large-title">{details.program.name}</Text>
          {statusBadge(details.program.status)}
        </header>

        <Surface className="program-details-summary">
          <List>
            <ListItem
              interactive={false}
              leading={<Avatar name={name} src={details.owner.photoUrl ?? undefined} />}
              title={details.ownerType === 'client' ? name : 'Моя программа'}
              subtitle={details.ownerType === 'client' ? 'Клиент' : name}
            />
            <ListItem
              interactive={false}
              title="Период программы"
              subtitle={period(details)}
            />
            <ListItem
              interactive={false}
              title="Выполнение"
              subtitle={exerciseProgressLabel(details)}
              trailing={<Badge color="blue">{details.progressPercent}%</Badge>}
            />
          </List>
          <div
            className="program-details-progress"
            role="progressbar"
            aria-label="Выполнение программы"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={details.progressPercent}
          >
            <span className="program-details-progress-value" style={{ width: `${details.progressPercent}%` }} />
          </div>
        </Surface>

        <section className="program-details-phases" aria-labelledby="program-phases-title">
          <Text id="program-phases-title" variant="title">Фазы</Text>
          {details.phases.length > 0 ? (
            <div className="program-details-phase-list">
              {details.phases.map((phase, index) => (
                <ProgramPhaseCard
                  key={phase.id}
                  phase={phase}
                  defaultCollapsed={phase.status !== 'active' && (hasActivePhase || index !== 0)}
                />
              ))}
            </div>
          ) : (
            <Text variant="footnote" tone="muted">Фазы пока не добавлены</Text>
          )}
        </section>
      </div>
    </section>
  );
}
