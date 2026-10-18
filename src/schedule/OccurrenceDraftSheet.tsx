import { useRef, useState } from 'react';
import type { CloudProgramDayOutline } from '../data/cloud/workout-foundation-types';
import type { LocalWorkoutOccurrenceDraft } from '../data/cloud/workout-occurrence-plan';
import type { WorkoutOccurrenceDraftRepository } from '../data/cloud/workout-occurrence-drafts';
import { appendOccurrenceExercise, appendOccurrenceSet, occurrencePlanChanged,
  removeOccurrenceExercise, removeOccurrenceSet, reorderOccurrenceExercises } from '../data/cloud/workout-occurrence-edit';
import { readProgramCatalogueExercise, programExerciseSnapshot } from '../data/cloud/program-exercise-selection';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { WorkoutPlanCard } from '../workout/WorkoutPlanCard';
import { WorkoutExerciseSelectionSheet } from '../workout/WorkoutExerciseSelectionSheet';
import { Button, DatePicker, MezfitBottomSheet, MezfitDialog, MezfitDialogButton,
  Text, TimePicker, IconButton, type LocalDate, type LocalTime } from '../ui';
import './occurrence-draft-sheet.css';

function localDate(date: Date): LocalDate {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, '0')).join('-') as LocalDate;
}
function localTime(date: Date): LocalTime {
  return [date.getHours(), date.getMinutes()].map(n => String(n).padStart(2, '0')).join(':') as LocalTime;
}
function currentEnd(draft: LocalWorkoutOccurrenceDraft): Date {
  return new Date(Date.parse(draft.startsAtUtc) + draft.durationMinutes * 60_000);
}
function localStart(date: LocalDate, time: LocalTime): string {
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  const instant = new Date(year, month - 1, day, hours, minutes);
  if (localDate(instant) !== date || localTime(instant) !== time) {
    throw new Error('Это местное время недоступно из-за перевода часов');
  }
  return instant.toISOString();
}
function outline(draft: LocalWorkoutOccurrenceDraft): CloudProgramDayOutline {
  return {
    day: { id: draft.programDayId, realmId: draft.realmId, owner: null,
      programPhaseId: '', status: 'active', position: 0, name: draft.plan.name,
      comment: draft.plan.comment },
    exercises: draft.plan.exercises.map(ex => ({
      exercise: { id: ex.id, realmId: draft.realmId, owner: null,
        programDayId: draft.programDayId, position: ex.position,
        exercise: ex.exercise, notes: ex.notes, status: 'active' },
      sets: ex.sets.map(set => ({
        id: set.id, realmId: draft.realmId, owner: null, programExerciseId: ex.id,
        position: set.position, status: 'active', setLabel: set.setLabel,
        comment: set.comment, plannedReps: set.plannedReps,
        plannedWeightKg: set.plannedWeightKg,
        plannedDurationSeconds: set.plannedDurationSeconds,
        plannedDistanceMeters: set.plannedDistanceMeters,
      })),
    })),
  };
}

export interface OccurrenceDraftSheetProps {
  draft: LocalWorkoutOccurrenceDraft | null;
  drafts: WorkoutOccurrenceDraftRepository;
  onClose: () => void;
  onSave: (draft: LocalWorkoutOccurrenceDraft, updateProgram: boolean) => Promise<void>;
}

export function OccurrenceDraftSheet({ draft, drafts, onClose, onSave }: OccurrenceDraftSheetProps) {
  const cloud = useCloudConnections();
  const [dateOpened, setDateOpened] = useState(false);
  const [timeOpened, setTimeOpened] = useState<'start' | 'end' | null>(null);
  const [exercisePickerOpened, setExercisePickerOpened] = useState(false);
  const [setPlaceholderOpen, setSetPlaceholderOpen] = useState(false);
  const [programUpdateOpen, setProgramUpdateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const startRef = useRef<HTMLSpanElement>(null);
  const endRef = useRef<HTMLSpanElement>(null);
  const editingRef = useRef(false);

  const edit = (apply: Parameters<WorkoutOccurrenceDraftRepository['edit']>[1]) => {
    if (!draft || editingRef.current) return;
    editingRef.current = true;
    setError('');
    void drafts.edit(draft.id, apply).catch(reason => {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить черновик');
    }).finally(() => { editingRef.current = false; });
  };
  const save = async (updateProgram: boolean) => {
    if (!draft || busy || editingRef.current) return;
    setProgramUpdateOpen(false);
    setBusy(true);
    setError('');
    try {
      await onSave(draft, updateProgram);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить тренировку');
    } finally { setBusy(false); }
  };
  const beginSave = () => {
    if (!draft || busy || editingRef.current) return;
    const owner = (draft.coachUserId ?? draft.athleteUserId) === draft.actorUserId;
    if (owner && occurrencePlanChanged(draft.plan, draft.originalPlan)) setProgramUpdateOpen(true);
    else void save(false);
  };
  const editStart = (date: LocalDate, time: LocalTime) => {
    try {
      const utc = localStart(date, time);
      edit(current => ({ ...current, startsAtUtc: utc }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Некорректная дата или время');
    }
  };
  const selectExercises = async (ids: string[]) => {
    if (!draft || !cloud || busy) return;
    setBusy(true); setError('');
    try {
      const selected = await Promise.all(ids.map(async id => programExerciseSnapshot(
        await readProgramCatalogueExercise(cloud.db, draft.actorUserId, id), draft.actorUserId)));
      await drafts.edit(draft.id, current => ({
        ...current, plan: selected.reduce(appendOccurrenceExercise, current.plan),
      }));
      setExercisePickerOpened(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось добавить упражнения');
    } finally { setBusy(false); }
  };
  const start = draft ? new Date(draft.startsAtUtc) : new Date();
  const end = draft ? currentEnd(draft) : new Date();
  return <>
    <MezfitBottomSheet opened={draft !== null} label="Запланировать тренировку" lazyMount>
      {draft ? <section className="occurrence-draft-sheet">
        <header className="occurrence-draft-sheet__header">
          <Text variant="headline">Запланировать тренировку</Text>
          <IconButton label="Закрыть" disabled={busy} onClick={onClose}>✕</IconButton>
        </header>
        <div className="occurrence-draft-sheet__body">
          {error ? <Text variant="footnote" role="alert">{error}</Text> : null}
          <div className="occurrence-draft-sheet__timing">
            <Button variant="secondary" onClick={() => setDateOpened(true)}>
              Дата: {localDate(start)}
            </Button>
            <span ref={startRef}><Button variant="secondary" onClick={() => setTimeOpened('start')}>
              Начало: {localTime(start)}
            </Button></span>
            <span ref={endRef}><Button variant="secondary" onClick={() => setTimeOpened('end')}>
              Конец: {localTime(end)}
            </Button></span>
          </div>
          <Text variant="body">Введите план на тренировку (не обязательно)</Text>
          <WorkoutPlanCard mode="planning" day={outline(draft)} programName={draft.plan.name}
            creatorName="План тренировки" hideProgramMenu hideWorkoutActions
            busy={busy} readOnly={false}
            onEdit={() => {}} onComment={() => {}} onMove={() => {}}
            onDuplicate={() => {}} onDelete={() => {}}
            onReorderExercises={ids => edit(current => ({
              ...current, plan: reorderOccurrenceExercises(current.plan, ids),
            }))}
            onAddExercise={() => setExercisePickerOpened(true)}
            onAddSet={id => edit(current => ({
              ...current, plan: appendOccurrenceSet(current.plan, id),
            }))}
            onDeleteExercise={id => edit(current => ({
              ...current, plan: removeOccurrenceExercise(current.plan, id),
            }))}
            onDeleteSet={(exerciseId, setId) => edit(current => ({
              ...current, plan: removeOccurrenceSet(current.plan, exerciseId, setId),
            }))}
            onOpenSet={() => setSetPlaceholderOpen(true)}
          />
        </div>
        <footer className="occurrence-draft-sheet__footer">
          <Button variant="secondary" color="red" disabled={busy} onClick={() => setDeleteOpen(true)}>
            Удалить черновик
          </Button>
          <Button disabled={busy} onClick={beginSave}>{busy ? 'Сохраняем…' : 'Сохранить'}</Button>
        </footer>
      </section> : null}
    </MezfitBottomSheet>
    {draft ? <>
      <DatePicker opened={dateOpened} value={localDate(start)}
        onChange={date => editStart(date, localTime(start))}
        onClose={() => setDateOpened(false)} />
      <TimePicker opened={timeOpened === 'start'} value={localTime(start)}
        target={startRef.current} onClose={() => setTimeOpened(null)}
        onChange={time => editStart(localDate(start), time)} />
      <TimePicker opened={timeOpened === 'end'} value={localTime(end)}
        target={endRef.current} onClose={() => setTimeOpened(null)}
        onChange={time => {
          const target = new Date(localStart(localDate(start), time));
          let duration = Math.round((target.getTime() - start.getTime()) / 60_000);
          if (duration <= 0) duration += 1440;
          edit(current => ({ ...current, durationMinutes: duration }));
        }} />
      <WorkoutExerciseSelectionSheet opened={exercisePickerOpened} initData=""
        personalCatalogueRole={draft.coachUserId === draft.actorUserId ? 'coach' : 'client'}
        saving={busy} actionError={error}
        onConfirm={ids => { void selectExercises(ids); }}
        onClose={() => setExercisePickerOpened(false)} />
      <MezfitDialog opened={setPlaceholderOpen} title="Редактор подхода"
        buttons={<MezfitDialogButton onClick={() => setSetPlaceholderOpen(false)}>Закрыть</MezfitDialogButton>}>
        <Text variant="body">Редактирование веса, повторений и времени появится в следующей версии.</Text>
      </MezfitDialog>
      <MezfitDialog opened={programUpdateOpen} title="Обновить этот день в программе?"
        buttons={<>
          <MezfitDialogButton disabled={busy} onClick={() => { void save(false); }}>Нет</MezfitDialogButton>
          <MezfitDialogButton strong disabled={busy} onClick={() => { void save(true); }}>Да</MezfitDialogButton>
        </>}>
        <Text variant="body">План запланированной тренировки сохранится в любом случае.</Text>
      </MezfitDialog>
      <MezfitDialog opened={deleteOpen} title="Удалить черновик?"
        buttons={<>
          <MezfitDialogButton onClick={() => setDeleteOpen(false)}>Отмена</MezfitDialogButton>
          <MezfitDialogButton strong onClick={() => {
            if (!draft) return;
            setBusy(true);
            void drafts.delete(draft.id).then(() => { setDeleteOpen(false); onClose(); })
              .catch(reason => setError(reason instanceof Error ? reason.message : 'Не удалось удалить'))
              .finally(() => setBusy(false));
          }}>Удалить</MezfitDialogButton>
        </>}>
        <Text variant="body">Несохранённые изменения будут потеряны.</Text>
      </MezfitDialog>
    </> : null}
  </>;
}
