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
  Text, TimePicker, Icon, IconButton, type LocalDate, type LocalTime } from '../ui';
import { localScheduleInstant, localScheduleEnd } from './calendar-time';
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
function outline(draft: LocalWorkoutOccurrenceDraft): CloudProgramDayOutline {
  return {
    day: { id: draft.programDayId, realmId: draft.realmId, owner: null,
      programPhaseId: '', status: 'active', position: 0, name: draft.plan.name,
      comment: draft.plan.comment, category: draft.plan.category ?? null },
    exercises: draft.plan.exercises.map(ex => ({
      exercise: { id: ex.id, realmId: draft.realmId, owner: null,
        programDayId: draft.programDayId, position: ex.position,
        exercise: ex.exercise, notes: ex.notes, status: 'active' },
      sets: ex.sets.map(set => ({
        id: set.id, realmId: draft.realmId, owner: null, programExerciseId: ex.id,
        position: set.position, status: 'active', setLabel: set.setLabel,
        comment: set.comment, materialLinks: set.materialLinks, chatLinks: set.chatLinks,
        plannedReps: set.plannedReps,
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
  const pendingEditsRef = useRef<Promise<void>>(Promise.resolve());
  const unsavedEditsRef = useRef<Array<Parameters<WorkoutOccurrenceDraftRepository['edit']>[1]>>([]);

  // Remove an intent only after its local transaction commits. A retry must
  // replay the failed intent before later edits or final confirmation.
  const flushEdits = (): Promise<void> => {
    if (!draft) return Promise.resolve();
    const targetId = draft.id;
    const next = pendingEditsRef.current.catch(() => undefined).then(async () => {
      while (unsavedEditsRef.current.length) {
        await drafts.edit(targetId, unsavedEditsRef.current[0]);
        unsavedEditsRef.current.shift();
      }
    });
    pendingEditsRef.current = next;
    void next.catch(reason => {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить черновик');
    });
    return next;
  };

  const edit = (apply: Parameters<WorkoutOccurrenceDraftRepository['edit']>[1]) => {
    if (!draft || busy) return;
    setError('');
    unsavedEditsRef.current.push(apply);
    void flushEdits();
  };
  const save = async (updateProgram: boolean) => {
    if (!draft || busy) return;
    setBusy(true);
    setError('');
    try {
      await flushEdits();
      const latest = await drafts.get(draft.id);
      if (!latest) throw new Error('Черновик не найден');
      await onSave(latest, updateProgram);
      setProgramUpdateOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить тренировку');
    } finally { setBusy(false); }
  };
  const beginSave = async () => {
    if (!draft || busy) return;
    setBusy(true);
    setError('');
    try {
      await flushEdits();
      const latest = await drafts.get(draft.id);
      if (!latest) throw new Error('Черновик не найден');
      const owner = (latest.coachUserId ?? latest.athleteUserId) === latest.actorUserId;
      if (owner && occurrencePlanChanged(latest.plan, latest.originalPlan)) {
        setProgramUpdateOpen(true);
      } else {
        await onSave(latest, false);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить тренировку');
    } finally { setBusy(false); }
  };
  const editStart = (date: LocalDate, time: LocalTime) => {
    try {
      const utc = localScheduleInstant(date, time);
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
      await flushEdits();
      unsavedEditsRef.current.push(current => ({
        ...current, plan: selected.reduce(appendOccurrenceExercise, current.plan),
      }));
      setExercisePickerOpened(false);
      await flushEdits();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось добавить упражнения');
    } finally { setBusy(false); }
  };
  const mayEditStructure = Boolean(draft && (draft.coachUserId ?? draft.athleteUserId) === draft.actorUserId);
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
              <span className="occurrence-draft-sheet__timing-label"><Icon name="calendar" style={{ width: 18, height: 18, flex: "0 0 18px" }} />Дата: {localDate(start)}</span>
            </Button>
            <span ref={startRef}><Button variant="secondary" onClick={() => setTimeOpened('start')}>
              <span className="occurrence-draft-sheet__timing-label"><Icon name="clock" style={{ width: 18, height: 18, flex: "0 0 18px" }} />Начало: {localTime(start)}</span>
            </Button></span>
            <span ref={endRef}><Button variant="secondary" onClick={() => setTimeOpened('end')}>
              <span className="occurrence-draft-sheet__timing-label"><Icon name="clock" style={{ width: 18, height: 18, flex: "0 0 18px" }} />Конец: {localTime(end)}</span>
            </Button></span>
          </div>
          <Text variant="body">Введите план на тренировку (не обязательно)</Text>
          <WorkoutPlanCard mode="planning" day={outline(draft)} programName={draft.plan.name}
            creatorName="План тренировки" hideProgramMenu hideWorkoutActions
            busy={busy} readOnly={!mayEditStructure}
            onEdit={() => {}} onComment={() => {}} onMove={() => {}}
            onDuplicate={() => {}} onDelete={() => {}}
            onReorderExercises={mayEditStructure ? ids => edit(current => ({
              ...current, plan: reorderOccurrenceExercises(current.plan, ids),
            })) : undefined}
            onAddExercise={mayEditStructure ? () => setExercisePickerOpened(true) : undefined}
            onAddSet={mayEditStructure ? id => edit(current => ({
              ...current, plan: appendOccurrenceSet(current.plan, id),
            })) : undefined}
            onDeleteExercise={mayEditStructure ? id => edit(current => ({
              ...current, plan: removeOccurrenceExercise(current.plan, id),
            })) : undefined}
            onDeleteSet={mayEditStructure ? (exerciseId, setId) => edit(current => ({
              ...current, plan: removeOccurrenceSet(current.plan, exerciseId, setId),
            })) : undefined}
            onOpenSet={() => setSetPlaceholderOpen(true)}
          />
        </div>
        <footer className="occurrence-draft-sheet__footer">
          <Button variant="secondary" color="red" disabled={busy} onClick={() => setDeleteOpen(true)}>
            Удалить черновик
          </Button>
          <Button disabled={busy} onClick={() => { void beginSave(); }}>{busy ? 'Сохраняем…' : 'Сохранить'}</Button>
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
          try {
            const target = Date.parse(localScheduleEnd(start, time));
            const duration = Math.round((target - start.getTime()) / 60_000);
            edit(current => ({ ...current, durationMinutes: duration }));
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Некорректное время окончания');
          }
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
