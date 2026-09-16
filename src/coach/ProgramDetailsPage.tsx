import { useEffect, useMemo, useState } from 'react';
import {
  createCoachProgramPhase,
  deleteCoachProgramPhase,
  getCoachExercises,
  getCoachProgramDetails,
  type CoachProgramDetails,
  type ExerciseDefinition,
  type ProgramPhaseDetails,
  type ProgramStatus,
} from '../api';
import { ProgramPhaseCard } from '../program/ProgramPhaseCard';
import { Avatar, Badge, Button, FloatingActionButton, List, ListItem, Modal, Surface, Text, TextInput } from '../ui';
import { SessionExercise } from '../workout/SessionExercise';
import type { SessionExerciseData } from '../workout/sessionExerciseTypes';
import './program-details.css';

function AddIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" fill="currentColor" />
    </svg>
  );
}

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

function previewSessionExercise(
  phase: ProgramPhaseDetails,
  fallbackExercise: ExerciseDefinition | null,
): SessionExerciseData | null {
  const source = phase.exercises[0] ?? null;
  const exercise = source?.exercise ?? fallbackExercise;
  if (!exercise) return null;
  const setCount = source ? source.setCount : 3;

  return {
    sessionExerciseId: source?.programExerciseId ?? -phase.id,
    workoutSessionId: 0,
    sourceProgramExerciseId: source?.programExerciseId ?? null,
    position: source?.position ?? 0,
    status: 'planned',
    notes: source?.notes ?? null,
    exercise,
    sets: Array.from({ length: setCount }, (_, position) => ({
      sessionSetId: -((phase.id * 1000) + position + 1),
      sourceProgramSetId: null,
      position,
      status: 'pending',
      plan: null,
      previous: null,
      fact: null,
    })),
  };
}

export function ProgramDetailsPage({ initData, programId }: { initData: string; programId: number }) {
  const [details, setDetails] = useState<CoachProgramDetails | null>(null);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [phaseCreateOpen, setPhaseCreateOpen] = useState(false);
  const [phaseName, setPhaseName] = useState('');
  const [phaseCreateBusy, setPhaseCreateBusy] = useState(false);
  const [phaseCreateError, setPhaseCreateError] = useState('');
  const [exercisePreviewPhaseId, setExercisePreviewPhaseId] = useState<number | null>(null);
  const [exercisePreviewFallback, setExercisePreviewFallback] = useState<ExerciseDefinition | null>(null);
  const [exercisePreviewLoading, setExercisePreviewLoading] = useState(false);
  const [exercisePreviewError, setExercisePreviewError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setDetails(null);
    setError('');
    getCoachProgramDetails(initData, programId)
      .then(({ details: result }) => {
        if (!cancelled) setDetails(result);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить программу');
      });
    return () => { cancelled = true; };
  }, [initData, programId, reloadKey]);

  useEffect(() => {
    const phase = details?.phases.find((candidate) => candidate.id === exercisePreviewPhaseId) ?? null;
    if (!phase || phase.exercises.length > 0) {
      setExercisePreviewFallback(null);
      setExercisePreviewLoading(false);
      setExercisePreviewError('');
      return undefined;
    }

    let cancelled = false;
    setExercisePreviewFallback(null);
    setExercisePreviewLoading(true);
    setExercisePreviewError('');
    getCoachExercises(initData, { sort: 'reference' })
      .then(({ exercises }) => {
        if (!cancelled) setExercisePreviewFallback(exercises[0] ?? null);
      })
      .catch((previewError: unknown) => {
        if (!cancelled) setExercisePreviewError(previewError instanceof Error ? previewError.message : 'Не удалось загрузить упражнение');
      })
      .finally(() => {
        if (!cancelled) setExercisePreviewLoading(false);
      });

    return () => { cancelled = true; };
  }, [details, exercisePreviewPhaseId, initData]);

  const hasActivePhase = useMemo(
    () => details?.phases.some((phase) => phase.status === 'active') ?? false,
    [details],
  );

  const openPhaseCreation = () => {
    setPhaseName('');
    setPhaseCreateError('');
    setPhaseCreateOpen(true);
  };

  const closePhaseCreation = () => {
    if (phaseCreateBusy) return;
    setPhaseCreateOpen(false);
    setPhaseName('');
    setPhaseCreateError('');
  };

  const savePhase = async () => {
    const name = phaseName.trim();
    if (!name || phaseCreateBusy) return;
    setPhaseCreateBusy(true);
    setPhaseCreateError('');
    try {
      const { phase } = await createCoachProgramPhase(initData, programId, name);
      setDetails((current) => current ? {
        ...current,
        program: current.program.status === 'finished'
          ? { ...current.program, status: 'draft', finishedAt: null }
          : current.program,
        phases: [...current.phases, phase],
      } : current);
      setPhaseCreateOpen(false);
      setPhaseName('');
    } catch (createError) {
      setPhaseCreateError(createError instanceof Error ? createError.message : 'Не удалось добавить фазу');
    } finally {
      setPhaseCreateBusy(false);
    }
  };

  const deletePhase = async (phaseId: number) => {
    const { details: nextDetails } = await deleteCoachProgramPhase(initData, programId, phaseId);
    setDetails(nextDetails);
  };

  const openExercisePreview = (phase: ProgramPhaseDetails) => {
    setExercisePreviewPhaseId(phase.id);
  };

  const closeExercisePreview = () => {
    setExercisePreviewPhaseId(null);
    setExercisePreviewFallback(null);
    setExercisePreviewLoading(false);
    setExercisePreviewError('');
  };

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
  const canCreatePhase = Boolean(phaseName.trim() && !phaseCreateBusy);
  const exercisePreviewPhase = details.phases.find((phase) => phase.id === exercisePreviewPhaseId) ?? null;
  const exercisePreviewData = exercisePreviewPhase
    ? previewSessionExercise(exercisePreviewPhase, exercisePreviewFallback)
    : null;

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
                  onDelete={deletePhase}
                  onAddExercise={openExercisePreview}
                />
              ))}
            </div>
          ) : (
            <Text variant="footnote" tone="muted">Фазы пока не добавлены</Text>
          )}
        </section>
      </div>

      <FloatingActionButton label="Добавить фазу" onClick={openPhaseCreation}>
        <AddIcon />
      </FloatingActionButton>

      <Modal
        isOpen={phaseCreateOpen}
        title="Добавить фазу"
        hasCloseButton={false}
        onClose={closePhaseCreation}
        actions={[
          { id: 'cancel', label: 'Отмена', onClick: closePhaseCreation, disabled: phaseCreateBusy },
          { id: 'save', label: phaseCreateBusy ? 'Добавление…' : 'Добавить', onClick: () => { void savePhase(); }, disabled: !canCreatePhase },
        ]}
      >
        <TextInput
          label="Название"
          value={phaseName}
          maxLength={120}
          error={phaseCreateError || undefined}
          onChange={(event) => {
            setPhaseName(event.target.value);
            if (phaseCreateError) setPhaseCreateError('');
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && canCreatePhase) void savePhase();
          }}
        />
      </Modal>

      <Modal
        isOpen={exercisePreviewPhase !== null}
        title="Добавить упражнение"
        onClose={closeExercisePreview}
      >
        {exercisePreviewPhase && exercisePreviewData ? (
          exercisePreviewData.sourceProgramExerciseId !== null ? (
            <SessionExercise
              mode="plan"
              programExerciseId={exercisePreviewData.sourceProgramExerciseId}
              context={{
                workoutSessionId: 0,
                workoutDate: exercisePreviewPhase.plannedStartDate ?? details.program.startedAt?.slice(0, 10) ?? '',
                program: { id: details.program.id, name: details.program.name },
              }}
              data={exercisePreviewData}
              onOpenExerciseMenu={() => {}}
              onOpenHistory={() => {}}
              onOpenChat={() => {}}
            />
          ) : (
            <SessionExercise
              mode="workout"
              context={{
                workoutSessionId: 0,
                workoutDate: exercisePreviewPhase.plannedStartDate ?? details.program.startedAt?.slice(0, 10) ?? '',
                program: { id: details.program.id, name: details.program.name },
              }}
              data={exercisePreviewData}
              onSaveSet={async () => {}}
              onOpenExerciseMenu={() => {}}
              onOpenHistory={() => {}}
              onOpenChat={() => {}}
            />
          )
        ) : exercisePreviewLoading ? (
          <Text tone="muted">Загружаем упражнение…</Text>
        ) : (
          <Text tone="muted">{exercisePreviewError || 'Нет доступных упражнений для предпросмотра'}</Text>
        )}
      </Modal>
    </section>
  );
}
