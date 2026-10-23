import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CloudProgramDayOutline } from '../data/cloud/workout-foundation-types';
import type { LocalWorkoutOccurrenceDraft } from '../data/cloud/workout-occurrence-plan';
import { isWorkoutEditRejected, type WorkoutOccurrenceDraftRepository } from '../data/cloud/workout-occurrence-drafts';
import { appendOccurrenceExercise, appendOccurrenceSet, occurrencePlanChanged,
  removeOccurrenceExercise, removeOccurrenceSet, reorderOccurrenceExercises } from '../data/cloud/workout-occurrence-edit';
import { readProgramCatalogueExercise, programExerciseSnapshot } from '../data/cloud/program-exercise-selection';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { WorkoutPlanCard } from '../workout/WorkoutPlanCard';
import { WorkoutExerciseSelectionSheet } from '../workout/WorkoutExerciseSelectionSheet';
import { Button, DatePicker, MezfitBottomSheet, MezfitDialog, MezfitDialogButton,
  Badge, Text, TimePicker, Icon, IconButton, LiquidPopover, type LocalDate, type LocalTime } from '../ui';
import { localScheduleInstant, localScheduleEnd } from './calendar-time';
import { useWorkoutPerson } from './WorkoutPerson';
import type { NavigationContext } from '../NavigationShell';
import { WorkoutPlanningRepository } from '../data/cloud/workout-planning';
import { WorkoutProgramSheet } from './WorkoutProgramSheet';
import { loadBrowserGlassSettings } from '../glassSettings';
import type { ProgramActor } from '../program/ProgramSummary';
import { WorkoutSyncStatus } from './WorkoutSyncStatus';
import './occurrence-draft-sheet.css';

const ProgramExerciseInformationSheet = lazy(() => import('../program/ProgramExerciseInformationSheet')
  .then(module => ({ default: module.ProgramExerciseInformationSheet })));

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
    day: { id: draft.programDayId ?? draft.id, realmId: draft.realmId, owner: null,
      programPhaseId: '', status: 'active', position: 0, name: draft.plan.name,
      comment: draft.plan.comment, category: draft.plan.category ?? null },
    exercises: draft.plan.exercises.map(ex => ({
      exercise: { id: ex.id, realmId: draft.realmId, owner: null,
        programDayId: draft.programDayId ?? draft.id, position: ex.position,
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
  actor?: ProgramActor;
  readOnly?: boolean;
  saveNotice?: string;
  onNavigationContextChange?: (value: NavigationContext | null) => void;
  onClose: () => void;
  onSave: (draft: LocalWorkoutOccurrenceDraft, updateProgram: boolean) => Promise<void>;
}

function OccurrenceDraftEditor({ draft, drafts, onClose, onSave, actor, readOnly = false, saveNotice = '', container, onNavigationContextChange }: OccurrenceDraftSheetProps & { container: HTMLDivElement }) {
  const cloud = useCloudConnections();
  const planner = useMemo(() => cloud ? new WorkoutPlanningRepository(cloud.db, cloud.actorUserId) : null,
    [cloud?.db, cloud?.actorUserId]);
  const [programSheetOpen, setProgramSheetOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [openProgramAfterMenu, setOpenProgramAfterMenu] = useState(false);
  const actionsRef = useRef<HTMLButtonElement>(null);
  const closeProgramSheet = useCallback(() => setProgramSheetOpen(false), []);
  const glass = loadBrowserGlassSettings();
  const owner = useWorkoutPerson(draft?.coachUserId ?? draft?.athleteUserId ?? null, draft?.realmId ?? '', actor);
  const [dateOpened, setDateOpened] = useState(false);
  const [timeOpened, setTimeOpened] = useState<'start' | 'end' | null>(null);
  const [exercisePickerOpened, setExercisePickerOpened] = useState(false);
  const [exerciseInformationId, setExerciseInformationId] = useState<string | null>(null);
  const [setPlaceholderOpen, setSetPlaceholderOpen] = useState(false);
  const [programUpdateOpen, setProgramUpdateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(() => draft ? drafts.pendingEditError(draft.id) : '');
  const [optimisticOrder, setOptimisticOrder] = useState<{ previous: string; next: string[] } | null>(null);
  const canonicalOrder = JSON.stringify(draft?.plan.exercises.map(exercise => exercise.id) ?? []);
  useEffect(() => {
    setOptimisticOrder((current) => current && current.previous !== canonicalOrder ? null : current);
  }, [canonicalOrder]);
  const startRef = useRef<HTMLSpanElement>(null);
  const endRef = useRef<HTMLSpanElement>(null);
  const validating = useRef<Promise<void>>(Promise.resolve());
  const rejectedTiming = useRef<string | null>(null);
  const timingIntent = useRef(0);
  const pendingTiming = useRef(false);
  useEffect(() => {
    if (!draft || readOnly) return;
    let active = true;
    // Reattach to pending/failed writes when reopening, including writes which
    // failed after the previous editor unmounted through Back or a tab change.
    void drafts.flushEdits(draft.id).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : 'Не удалось сохранить черновик');
    });
    return () => { active = false; };
  }, [draft?.id, drafts, readOnly]);

  const flushEdits = async () => {
    await validating.current;
    if (rejectedTiming.current) throw new Error(rejectedTiming.current);
    try {
      if (draft) await drafts.flushEdits(draft.id);
      pendingTiming.current = false;
    }
    catch (reason) {
      if (pendingTiming.current && isWorkoutEditRejected(reason)) rejectedTiming.current = reason.message;
      throw reason;
    }
  };
  const edit = (apply: Parameters<WorkoutOccurrenceDraftRepository['edit']>[1], timing = false) => {
    if (!draft || busy || readOnly) return;
    const intent = timing ? ++timingIntent.current : 0;
    if (timing) { rejectedTiming.current = null; pendingTiming.current = true; }
    setError(rejectedTiming.current ?? '');
    let accepted = false;
    const next = validating.current.catch(() => undefined).then(async () => {
      const current = await drafts.get(draft.id);
      if (!current) throw new Error('Черновик не найден');
      accepted = true;
      await drafts.enqueueEdit(draft.id, apply);
      if (timing && intent === timingIntent.current) pendingTiming.current = false;
    });
    // Invalid local choices block Save. A storage failure is retained by the
    // repository queue instead, so Save can retry that accepted edit.
    validating.current = next.catch(reason => {
      if (timing && intent === timingIntent.current && isWorkoutEditRejected(reason)) {
        rejectedTiming.current = reason.message;
        pendingTiming.current = false;
      }
      if (!accepted) throw reason;
    });
    void validating.current.catch(() => undefined);
    void next.catch(reason => {
      if (timing && intent !== timingIntent.current) return;
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить черновик');
    });
    return next;
  };
  const save = async (updateProgram: boolean) => {
    if (!draft || busy || readOnly) return;
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
    if (!draft || busy || readOnly) return;
    setBusy(true);
    setError('');
    try {
      await flushEdits();
      const latest = await drafts.get(draft.id);
      if (!latest) throw new Error('Черновик не найден');
      const owner = (latest.coachUserId ?? latest.athleteUserId) === latest.actorUserId;
      if (!latest.autoCreatedProgram && latest.trainingPlanId && latest.programDayId
        && !latest.previouslyPublished && owner && occurrencePlanChanged(latest.plan, latest.originalPlan)) {
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
      edit(current => ({ ...current, startsAtUtc: utc }), true);
    } catch (reason) {
      ++timingIntent.current;
      rejectedTiming.current = reason instanceof Error ? reason.message : 'Некорректная дата или время';
      setError(rejectedTiming.current);
    }
  };
  const selectExercises = async (ids: string[]) => {
    if (!draft || !cloud || busy) return;
    setBusy(true); setError('');
    try {
      const selected = await Promise.all(ids.map(async id => programExerciseSnapshot(
        await readProgramCatalogueExercise(cloud.db, draft.actorUserId, id), draft.actorUserId)));
      await flushEdits();
      const writing = drafts.enqueueEdit(draft.id, current => ({
        ...current, plan: selected.reduce(appendOccurrenceExercise, current.plan),
      }));
      setExercisePickerOpened(false);
      await writing;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось добавить упражнения');
    } finally { setBusy(false); }
  };
  const mayEditStructure = Boolean(draft && !readOnly && (draft.coachUserId ?? draft.athleteUserId) === draft.actorUserId);
  let displayedDay = draft ? outline(draft) : null;
  if (displayedDay && optimisticOrder) {
    const positions = new Map(optimisticOrder.next.map((id, index) => [id, index]));
    displayedDay = { ...displayedDay, exercises: [...displayedDay.exercises].sort((a, b) =>
      (positions.get(a.exercise.id) ?? a.exercise.position) - (positions.get(b.exercise.id) ?? b.exercise.position)) };
  }
  const informationExercise = draft?.plan.exercises.find(item => item.id === exerciseInformationId);
  const start = draft ? new Date(draft.startsAtUtc) : new Date();
  const end = draft ? currentEnd(draft) : new Date();
  return <>
      {draft ? createPortal(<section className="occurrence-draft-sheet">
        <header className="occurrence-draft-sheet__header">
          <Text variant="headline">Запланированная тренировка</Text>
          {planner ? <LiquidPopover isOpen={actionsOpen} onOpenChange={setActionsOpen}
            triggerRef={actionsRef} label="Меню тренировки" preset={glass.preset} optics={glass.optics}
            trigger={<IconButton ref={actionsRef} icon="dots-vertical" label="Меню тренировки" disabled={busy} />}
            items={[{ id: 'program', label: 'Добавить в программу', icon: 'copy', disabled: busy,
              onSelect: () => { setOpenProgramAfterMenu(true); setActionsOpen(false); } }]}
            onPresentationChange={presented => {
              if (presented || !openProgramAfterMenu) return;
              setOpenProgramAfterMenu(false);
              void flushEdits().then(() => setProgramSheetOpen(true))
                .catch(reason => setError(reason instanceof Error ? reason.message : 'Не удалось сохранить правки'));
            }} /> : null}
          <IconButton label="Закрыть" onClick={onClose}>✕</IconButton>
        </header>
        <div className="occurrence-draft-sheet__body">
          {error || saveNotice ? <Text variant="footnote" role="alert">{error || saveNotice}</Text> : null}
          <div className="occurrence-draft-sheet__format">
            <Text variant="body">{draft.format === 'coached' ? 'С тренером в зале' : 'Самостоятельная'}</Text>
            <Icon name={draft.format === 'coached' ? 'users' : 'user'} style={{ width: 22, height: 22 }} />
          </div>
          <div className="occurrence-draft-sheet__statuses">
            <WorkoutSyncStatus draft={draft} repository={drafts} />
            <Badge color={draft.saved ? 'green' : 'yellow'} textVariant="caption">{draft.saved ? 'Запланировано' : 'Черновик'}</Badge>
          </div>
          <div className="occurrence-draft-sheet__timing">
            <Button variant="secondary" disabled={busy || readOnly} onClick={() => setDateOpened(true)}>
              <span className="occurrence-draft-sheet__timing-label"><Icon name="calendar" style={{ width: 18, height: 18, flex: "0 0 18px" }} />Дата: {localDate(start)}</span>
            </Button>
            <span ref={startRef}><Button variant="secondary" disabled={busy || readOnly} onClick={() => setTimeOpened('start')}>
              <span className="occurrence-draft-sheet__timing-label"><Icon name="clock" style={{ width: 18, height: 18, flex: "0 0 18px" }} />Начало: {localTime(start)}</span>
            </Button></span>
            <span ref={endRef}><Button variant="secondary" disabled={busy || readOnly} onClick={() => setTimeOpened('end')}>
              <span className="occurrence-draft-sheet__timing-label"><Icon name="clock" style={{ width: 18, height: 18, flex: "0 0 18px" }} />Конец: {localTime(end)}</span>
            </Button></span>
          </div>
          <Text variant="body">План на тренировку</Text>
          <WorkoutPlanCard mode="planning" day={displayedDay!} programName={draft.plan.name} hideProgramName={!draft.trainingPlanId}
            portalDragOverlay preserveDragHeight
            creatorName={owner.name} creatorAvatar={owner.avatar} hideProgramMenu hideWorkoutActions
            busy={busy} readOnly={!mayEditStructure}
            onEdit={() => {}} onComment={() => {}} onMove={() => {}}
            onDuplicate={() => {}} onDelete={() => {}}
            onReorderExercises={mayEditStructure ? ids => {
              setOptimisticOrder({ previous: canonicalOrder, next: ids });
              const write = edit(current => ({
                ...current, plan: reorderOccurrenceExercises(current.plan, ids),
              }));
              if (!write) setOptimisticOrder(null);
              else void write.catch(() => setOptimisticOrder((current) => current?.next === ids ? null : current));
            } : undefined}
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
            onExerciseInformation={planner ? setExerciseInformationId : undefined}
          />
        </div>
        {!readOnly && !draft.saved ? <footer className="occurrence-draft-sheet__footer">
          <Button variant="secondary" color="red" disabled={busy || readOnly} onClick={() => setDeleteOpen(true)}>
            {draft.previouslyPublished ? 'Отменить изменения' : 'Удалить черновик'}
          </Button>
          <Button disabled={busy} onClick={() => { void beginSave(); }}>{busy ? 'Сохраняем…' : 'Сохранить'}</Button>
        </footer> : null}
      </section>, container) : null}
    {draft ? <>
      {planner && informationExercise ? <Suspense fallback={<Text variant="footnote">Загружаем информацию…</Text>}>
        <ProgramExerciseInformationSheet key={informationExercise.id} repository={planner.programs}
          exerciseId={informationExercise.id} snapshot={informationExercise.exercise} realmId={draft.realmId}
          onClose={() => setExerciseInformationId(null)} onNavigationContextChange={onNavigationContextChange} />
      </Suspense> : null}
      {planner ? <WorkoutProgramSheet opened={programSheetOpen} planner={planner} draft={draft}
        onClose={closeProgramSheet} onNavigationContextChange={onNavigationContextChange} /> : null}
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
            edit(current => ({ ...current, durationMinutes: duration }), true);
          } catch (reason) {
            ++timingIntent.current;
            rejectedTiming.current = reason instanceof Error ? reason.message : 'Некорректное время окончания';
            setError(rejectedTiming.current);
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

/** Keep the animated shell mounted closed before opening; reset each editor by ID. */
export function OccurrenceDraftSheet(props: OccurrenceDraftSheetProps) {
  const [retained, setRetained] = useState(props.draft);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  useEffect(() => { if (props.draft) setRetained(props.draft); }, [props.draft]);
  const draft = props.draft ?? retained;
  return <><MezfitBottomSheet opened={props.draft !== null} label="Запланированная тренировка" lazyMount
    onClosed={() => { if (!props.draft) setRetained(null); }}>
    <div ref={setContainer} className="occurrence-draft-sheet__host" />
  </MezfitBottomSheet>
    {/* Only form content enters our host; pickers/dialogs remain outside the animated transform. */}
    {draft && container ? <OccurrenceDraftEditor key={draft.id} {...props} draft={draft} container={container} /> : null}
  </>;
}
