import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { STARTED_PLAN_MESSAGE as lockedPlanMessage } from '../data/cloud/planned-session-policy';
import { createPortal } from 'react-dom';
import { Toast } from 'konsta/react';
import type { CloudProgramDayOutline } from '../data/cloud/workout-foundation-types';
import type { LocalWorkoutOccurrenceDraft } from '../data/cloud/workout-occurrence-plan';
import { isWorkoutEditRejected, type WorkoutOccurrenceDraftRepository } from '../data/cloud/workout-occurrence-drafts';
import { appendOccurrenceExercise, appendOccurrenceSet, occurrenceTemplateChanged,
  removeOccurrenceExercise, removeOccurrenceSet, reorderOccurrenceExercises } from '../data/cloud/workout-occurrence-edit';
import { readProgramCatalogueExercise, programExerciseSnapshot } from '../data/cloud/program-exercise-selection';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { WorkoutPlanCard, WorkoutPlanCardHeader } from '../workout/WorkoutPlanCard';
import { StartWorkoutButton } from '../workout/StartWorkoutButton';
import { SetEntry } from '../workout/SetEntry';
import type { ExerciseTrackingType } from '../data/exercises/publicExerciseTypes';
import { WorkoutExerciseSelectionSheet } from '../workout/WorkoutExerciseSelectionSheet';
import { Button, DatePicker, MezfitBottomSheet, MezfitDialog, MezfitDialogButton,
  Badge, Text, TimePicker, GlassSurface, Icon, IconButton, LiquidPopover, type LocalDate, type LocalTime } from '../ui';
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
        position: set.position, status: 'active', setType: set.setType ?? null, setLabel: set.setLabel,
        comment: set.comment, materialLinks: set.materialLinks, chatLinks: set.chatLinks,
        plannedReps: set.plannedReps,
        plannedWeightKg: set.plannedWeightKg,
        plannedDurationSeconds: set.plannedDurationSeconds,
        plannedDistanceMeters: set.plannedDistanceMeters,
      })),
    })),
  };
}

/** Read the transition timing through our own sheet id; Konsta still owns the animation. */
function openingTransitionDuration(element: Element): number {
  const style = window.getComputedStyle(element);
  if (style.transitionProperty === 'none') return 0;
  const milliseconds = (value: string) => {
    const token = value.trim();
    const amount = Number.parseFloat(token) || 0;
    return token.endsWith('ms') ? amount : amount * 1000;
  };
  const durations = style.transitionDuration.split(',').map(milliseconds);
  const delays = style.transitionDelay.split(',').map(milliseconds);
  return Math.max(0, ...durations.map((duration, index) => duration + (delays[index % delays.length] ?? 0)));
}

export interface OccurrenceDraftSheetProps {
  draft: LocalWorkoutOccurrenceDraft | null;
  drafts: WorkoutOccurrenceDraftRepository;
  actor?: ProgramActor;
  readOnly?: boolean;
  /** Owner-controlled lock; pass the frozen occurrence PLAN in draft after Start. */
  planLocked?: boolean;
  /** Called with the latest locally persisted draft after all pending edits flush. */
  onStart?: (draft: LocalWorkoutOccurrenceDraft) => Promise<void>;
  onCancel?: (draft: LocalWorkoutOccurrenceDraft) => void;
  onClosed?: () => void;
  suspended?: boolean;
  saveNotice?: string;
  sourceProgramName?: string | null;
  onNavigationContextChange?: (value: NavigationContext | null) => void;
  onClose: () => void;
  onSave: (draft: LocalWorkoutOccurrenceDraft, updateProgram: boolean) => Promise<void>;
}

export interface OccurrenceDraftCardProps extends OccurrenceDraftSheetProps {
  collapsed: boolean;
  onCollapsedChange: () => void;
}



function OccurrenceDraftEditor({ draft, drafts, onClose, onSave, onStart, onCancel, planLocked = false,
  actor, readOnly = false, saveNotice = '', sourceProgramName, container,
  onNavigationContextChange, auxiliaryReady, inlineCard = false, collapsed = false, onCollapsedChange,
}: OccurrenceDraftSheetProps & { container?: HTMLDivElement; auxiliaryReady: boolean;
  inlineCard?: boolean; collapsed?: boolean; onCollapsedChange?: () => void }) {
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
  const [timeSelection, setTimeSelection] = useState<{ kind: 'start' | 'end'; value: LocalTime } | null>(null);
  const timeSelectionRef = useRef<{ kind: 'start' | 'end'; value: LocalTime } | null>(null);
  const [exercisePickerOpened, setExercisePickerOpened] = useState(false);
  const [exerciseInformationId, setExerciseInformationId] = useState<string | null>(null);
  const [editingSet, setEditingSet] = useState<{ exerciseId: string; setId: string; trackingType: ExerciseTrackingType } | null>(null);
  const [programUpdateOpen, setProgramUpdateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const starting = useRef(false);
  const startAlive = useRef(true);
  useEffect(() => {
    startAlive.current = true;
    return () => { startAlive.current = false; };
  }, []);
  const access = useRef({ planLocked, readOnly });
  access.current = { planLocked, readOnly };
  const [lockToastVersion, setLockToastVersion] = useState(0);
  const onMutationAttempt = () => setLockToastVersion(version => version + 1);
  const mutationBlocked = () => {
    if (access.current.planLocked) { onMutationAttempt(); return true; }
    return access.current.readOnly;
  };
  useEffect(() => {
    if (!lockToastVersion) return;
    const timer = window.setTimeout(() => setLockToastVersion(0), 3000);
    return () => window.clearTimeout(timer);
  }, [lockToastVersion]);
  const [error, setError] = useState(() => draft ? drafts.pendingEditError(draft.id) : '');
  const reportPlanError = (reason: unknown, fallback: string) => {
    if (!startAlive.current) return;
    if (reason instanceof Error && reason.message === lockedPlanMessage) {
      setError(''); onMutationAttempt();
    } else setError(reason instanceof Error ? reason.message : fallback);
  };
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
    if (!draft || readOnly || planLocked) return;
    let active = true;
    // Reattach to pending/failed writes when reopening, including writes which
    // failed after the previous editor unmounted through Back or a tab change.
    void drafts.flushEdits(draft.id).catch(reason => {
      if (active) reportPlanError(reason, 'Не удалось сохранить черновик');
    });
    return () => { active = false; };
  }, [draft?.id, drafts, readOnly, planLocked]);

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
    if (mutationBlocked() || !draft || busy || starting.current) return;
    const intent = timing ? ++timingIntent.current : 0;
    if (timing) { rejectedTiming.current = null; pendingTiming.current = true; }
    setError(rejectedTiming.current ?? '');
    let accepted = false;
    const next = validating.current.catch(() => undefined).then(async () => {
      const current = await drafts.get(draft.id);
      if (!current) throw new Error('Черновик не найден');
      if (mutationBlocked()) return;
      accepted = true;
      await drafts.enqueueEdit(draft.id, current => {
        // Returning the unchanged draft drains a stale intent without a content/timing write.
        if (mutationBlocked()) return current;
        return apply(current);
      });
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
      reportPlanError(reason, 'Не удалось сохранить черновик');
    });
    return next;
  };
  const save = async (updateProgram: boolean) => {
    if (mutationBlocked() || !draft || busy || starting.current) return;
    setBusy(true);
    setError('');
    try {
      await flushEdits();
      const latest = await drafts.get(draft.id);
      if (!latest) throw new Error('Черновик не найден');
      if (mutationBlocked()) return;
      await onSave(latest, updateProgram);
      setProgramUpdateOpen(false);
    } catch (reason) {
      reportPlanError(reason, 'Не удалось сохранить тренировку');
    } finally { setBusy(false); }
  };
  const beginSave = async () => {
    if (mutationBlocked() || !draft || busy || starting.current) return;
    setBusy(true);
    setError('');
    try {
      await flushEdits();
      const latest = await drafts.get(draft.id);
      if (!latest) throw new Error('Черновик не найден');
      if (mutationBlocked()) return;
      const owner = (latest.coachUserId ?? latest.athleteUserId) === latest.actorUserId;
      if (!latest.autoCreatedProgram && latest.trainingPlanId && latest.programDayId
        && !latest.previouslyPublished && owner && occurrenceTemplateChanged(latest.plan, latest.originalPlan)) {
        setProgramUpdateOpen(true);
      } else {
        await onSave(latest, false);
      }
    } catch (reason) {
      reportPlanError(reason, 'Не удалось сохранить тренировку');
    } finally { setBusy(false); }
  };
  const startWorkout = async () => {
    if (!startAlive.current || !draft || !onStart || busy || starting.current
      || access.current.planLocked || access.current.readOnly) return;
    starting.current = true;
    setBusy(true);
    setError('');
    try {
      await flushEdits();
      if (!startAlive.current || access.current.planLocked || access.current.readOnly) return;
      const latest = await drafts.get(draft.id);
      if (!latest) throw new Error('Черновик не найден');
      if (!startAlive.current || access.current.planLocked || access.current.readOnly) return;
      await onStart(latest);
    } catch (reason) {
      if (startAlive.current) setError(reason instanceof Error ? reason.message : 'Не удалось начать тренировку');
    } finally {
      starting.current = false;
      if (startAlive.current) setBusy(false);
    }
  };
  const editStart = (date: LocalDate, time: LocalTime) => {
    if (mutationBlocked()) return;
    try {
      const utc = localScheduleInstant(date, time);
      edit(current => ({ ...current, startsAtUtc: utc }), true);
    } catch (reason) {
      ++timingIntent.current;
      rejectedTiming.current = reason instanceof Error ? reason.message : 'Некорректная дата или время';
      setError(rejectedTiming.current);
    }
  };
  const openTimePicker = (kind: 'start' | 'end') => {
    if (mutationBlocked()) return;
    timeSelectionRef.current = null;
    setTimeSelection(null);
    setTimeOpened(kind);
  };
  const chooseTime = (kind: 'start' | 'end', value: LocalTime) => {
    if (mutationBlocked()) return;
    timeSelectionRef.current = { kind, value };
    setTimeSelection({ kind, value });
  };
  const closeTimePicker = () => {
    const choice = timeSelectionRef.current;
    timeSelectionRef.current = null;
    setTimeSelection(null);
    setTimeOpened(null);
    if (!choice || mutationBlocked() || !draft || busy || starting.current) return;
    const start = new Date(draft.startsAtUtc);
    const end = currentEnd(draft);
    if (choice.kind === 'start') {
      if (choice.value !== localTime(start)) editStart(localDate(start), choice.value);
      return;
    }
    if (choice.value === localTime(end)) return;
    try {
      const target = Date.parse(localScheduleEnd(start, choice.value));
      const duration = Math.round((target - start.getTime()) / 60_000);
      edit(current => ({ ...current, durationMinutes: duration }), true);
    } catch (reason) {
      ++timingIntent.current;
      rejectedTiming.current = reason instanceof Error ? reason.message : 'Некорректное время окончания';
      setError(rejectedTiming.current);
    }
  };
  const selectExercises = async (ids: string[]) => {
    if (mutationBlocked() || !draft || !cloud || busy || starting.current) return;
    setBusy(true); setError('');
    try {
      const selected = await Promise.all(ids.map(async id => programExerciseSnapshot(
        await readProgramCatalogueExercise(cloud.db, draft.actorUserId, id), draft.actorUserId)));
      await flushEdits();
      if (mutationBlocked()) return;
      const writing = drafts.enqueueEdit(draft.id, current => {
        if (mutationBlocked()) return current;
        return { ...current, plan: selected.reduce(appendOccurrenceExercise, current.plan) };
      });
      setExercisePickerOpened(false);
      await writing;
    } catch (reason) {
      reportPlanError(reason, 'Не удалось добавить упражнения');
    } finally { setBusy(false); }
  };
  const mayEditStructure = Boolean(draft && !readOnly && (draft.coachUserId ?? draft.athleteUserId) === draft.actorUserId);
  let displayedDay = draft ? outline(draft) : null;
  if (displayedDay && optimisticOrder && !planLocked) {
    const positions = new Map(optimisticOrder.next.map((id, index) => [id, index]));
    displayedDay = { ...displayedDay, exercises: [...displayedDay.exercises].sort((a, b) =>
      (positions.get(a.exercise.id) ?? a.exercise.position) - (positions.get(b.exercise.id) ?? b.exercise.position)) };
  }
  const informationExercise = draft?.plan.exercises.find(item => item.id === exerciseInformationId);
  const activeExercise = draft?.plan.exercises.find(item => item.id === editingSet?.exerciseId);
  const activeSet = activeExercise?.sets.find(item => item.id === editingSet?.setId);
  const openSet = async (exerciseId: string, setId: string) => {
    if (access.current.planLocked) { onMutationAttempt(); return; }
    if (!draft || !planner || busy) return;
    const exercise = draft.plan.exercises.find(item => item.id === exerciseId);
    if (!exercise?.sets.some(item => item.id === setId)) return;
    try {
      const type = await planner.programs.trackingTypeForExercise(exercise.exercise);
      if (!type) {
        setError('Не удалось определить тип учёта упражнения');
        return;
      }
      if (access.current.planLocked) { onMutationAttempt(); return; }
      setEditingSet({ exerciseId, setId, trackingType: type });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось открыть подход');
    }
  };
  const start = draft ? new Date(draft.startsAtUtc) : new Date();
  const end = draft ? currentEnd(draft) : new Date();
  const scheduledTiming = { date: localDate(start).split('-').reverse().join('.'),
    time: `${localTime(start)} – ${localTime(end)}` };
  const content = draft ? <section className={`occurrence-draft-sheet${inlineCard ? ' occurrence-draft-sheet--inline' : ''}`}>
        {inlineCard ? <div className="occurrence-draft-sheet__identity"><WorkoutPlanCardHeader name={draft.plan.name}
          programName={sourceProgramName ?? undefined} hideProgramName={!sourceProgramName}
          creatorName={owner.name} creatorAvatar={owner.avatar}
          scheduledTiming={scheduledTiming}
          collapsed={collapsed} onCollapsedChange={onCollapsedChange} /></div> : null}
        {!collapsed ? <>
        <header className="occurrence-draft-sheet__header">
          {!inlineCard ? <Text variant="headline">Запланированная тренировка</Text> : null}
          {planner ? <LiquidPopover isOpen={actionsOpen} onOpenChange={setActionsOpen}
            triggerRef={actionsRef} label="Меню тренировки" preset={glass.preset} optics={glass.optics}
            trigger={<IconButton ref={actionsRef} icon="dots-vertical" label="Меню тренировки" disabled={busy} />}
            items={[{ id: 'program', label: 'Добавить в программу', icon: 'copy', disabled: busy,
              onSelect: () => { if (mutationBlocked()) return; setOpenProgramAfterMenu(true); setActionsOpen(false); } }]}
            onPresentationChange={presented => {
              if (presented || !openProgramAfterMenu) return;
              setOpenProgramAfterMenu(false);
              void flushEdits().then(() => { if (!mutationBlocked()) setProgramSheetOpen(true); })
                .catch(reason => setError(reason instanceof Error ? reason.message : 'Не удалось сохранить правки'));
            }} /> : null}
          {!inlineCard ? <IconButton label="Закрыть" onClick={onClose}>✕</IconButton> : null}
        </header>
        <div className="occurrence-draft-sheet__body">
          {error || saveNotice ? <Text variant="footnote" role="alert">{error || saveNotice}</Text> : null}
          <div className="occurrence-draft-sheet__format">
            <Text variant="body">{draft.format === 'coached' ? 'С тренером в зале' : 'Самостоятельная'}</Text>
            <Icon name={draft.format === 'coached' ? 'users' : 'user'} style={{ width: 22, height: 22 }} />
            {draft.format === 'coached' && draft.coachUserId
              ? <span className="occurrence-draft-sheet__coach-avatar">{owner.compactAvatar}</span> : null}
          </div>
          <div className="occurrence-draft-sheet__statuses">
            <WorkoutSyncStatus draft={draft} repository={drafts} />
            <Badge color={draft.saved ? 'green' : 'yellow'} textVariant="caption">{draft.saved ? 'Запланировано' : 'Черновик'}</Badge>
          </div>
          <div className="occurrence-draft-sheet__timing">
            <Button variant="secondary" size="compact" disabled={busy || readOnly} onClick={() => { if (!mutationBlocked()) setDateOpened(true); }}>
              <span className="occurrence-draft-sheet__timing-label"><Icon name="calendar" style={{ width: 18, height: 18, flex: "0 0 18px" }} />Дата: {localDate(start)}</span>
            </Button>
            <div className="occurrence-draft-sheet__time-row">
              <span ref={startRef}><Button variant="secondary" size="compact" disabled={busy || readOnly} onClick={() => openTimePicker('start')}>
                <span className="occurrence-draft-sheet__timing-label"><Icon name="clock" style={{ width: 18, height: 18, flex: "0 0 18px" }} />Начало: {localTime(start)}</span>
              </Button></span>
              <span ref={endRef}><Button variant="secondary" size="compact" disabled={busy || readOnly} onClick={() => openTimePicker('end')}>
                <span className="occurrence-draft-sheet__timing-label"><Icon name="clock" style={{ width: 18, height: 18, flex: "0 0 18px" }} />Конец: {localTime(end)}</span>
              </Button></span>
            </div>
          </div>
          <Text variant="body">План на тренировку</Text>
          <WorkoutPlanCard mode="planning" hideHeader={inlineCard} onCollapsedChange={inlineCard ? undefined : onClose}
            scheduledTiming={scheduledTiming} showPlanMetrics day={displayedDay!} programName={sourceProgramName ?? undefined} hideProgramName={!sourceProgramName}
            portalDragOverlay preserveDragHeight
            creatorName={owner.name} creatorAvatar={owner.avatar} hideProgramMenu hideWorkoutActions
            busy={busy} readOnly={!mayEditStructure}
            onMutationAttempt={planLocked ? onMutationAttempt : undefined}
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
            onAddExercise={mayEditStructure ? () => { if (!mutationBlocked()) setExercisePickerOpened(true); } : undefined}
            onAddSet={mayEditStructure ? id => edit(current => ({
              ...current, plan: appendOccurrenceSet(current.plan, id),
            })) : undefined}
            onDeleteExercise={mayEditStructure ? id => edit(current => ({
              ...current, plan: removeOccurrenceExercise(current.plan, id),
            })) : undefined}
            onDeleteSet={mayEditStructure ? (exerciseId, setId) => edit(current => ({
              ...current, plan: removeOccurrenceSet(current.plan, exerciseId, setId),
            })) : undefined}
            onOpenSet={planner ? (exerciseId, setId) => { void openSet(exerciseId, setId); } : undefined}
            onExerciseInformation={planner ? setExerciseInformationId : undefined}
          />
        </div>
        {!readOnly && !planLocked && onCancel ? <Button variant="secondary" disabled={busy} onClick={() => {
          if (!mutationBlocked() && !starting.current) onCancel(draft);
        }}>Отменить тренировку</Button> : null}
        {!readOnly && !draft.saved ? <footer className="occurrence-draft-sheet__footer">
          <Button variant="secondary" color="red" disabled={busy || readOnly} onClick={() => { if (!mutationBlocked()) setDeleteOpen(true); }}>
            {draft.previouslyPublished ? 'Отменить изменения' : 'Удалить черновик'}
          </Button>
          <Button disabled={busy} onClick={() => { void beginSave(); }}>{busy ? 'Сохраняем…' : 'Сохранить'}</Button>
        </footer> : null}
        {onStart ? <div className="occurrence-draft-sheet__start">
          <StartWorkoutButton disabled={busy || planLocked || readOnly}
            onClick={() => { void startWorkout(); }} />
        </div> : null}
        </> : null}
      </section> : null;
  return <>
    {container ? createPortal(content, container) : inlineCard
      ? <GlassSurface preset="modalTuned" optics={glass.optics}>{content}</GlassSurface> : content}
    {lockToastVersion > 0 ? <Toast opened position="center" role="status" aria-live="polite">
      <Text variant="body">{lockedPlanMessage}</Text>
    </Toast> : null}
    {draft && auxiliaryReady && !collapsed ? <>
      {planner && informationExercise ? <Suspense fallback={<Text variant="footnote">Загружаем информацию…</Text>}>
        <ProgramExerciseInformationSheet key={informationExercise.id} repository={planner.programs}
          exerciseId={informationExercise.id} snapshot={informationExercise.exercise} realmId={draft.realmId}
          onClose={() => setExerciseInformationId(null)} onNavigationContextChange={onNavigationContextChange} />
      </Suspense> : null}
      {planner ? <WorkoutProgramSheet opened={programSheetOpen && !planLocked && !readOnly} planner={planner} draft={draft}
        onClose={closeProgramSheet} onNavigationContextChange={onNavigationContextChange} /> : null}
      <DatePicker opened={dateOpened} value={localDate(start)}
        onChange={date => editStart(date, localTime(start))}
        onClose={() => setDateOpened(false)} />
      <TimePicker opened={timeOpened === 'start'} value={timeSelection?.kind === 'start' ? timeSelection.value : localTime(start)}
        target={startRef.current} onClose={closeTimePicker}
        onChange={time => chooseTime('start', time)} />
      <TimePicker opened={timeOpened === 'end'} value={timeSelection?.kind === 'end' ? timeSelection.value : localTime(end)}
        target={endRef.current} onClose={closeTimePicker}
        onChange={time => chooseTime('end', time)} />
      <WorkoutExerciseSelectionSheet opened={exercisePickerOpened} initData=""
        personalCatalogueRole={draft.coachUserId === draft.actorUserId ? 'coach' : 'client'}
        saving={busy} actionError={error}
        onConfirm={ids => { void selectExercises(ids); }}
        onClose={() => setExercisePickerOpened(false)} />
      {activeExercise && activeSet && editingSet ? <SetEntry
        key={activeSet.id} mode="occurrence-plan" isOpen readOnly={!mayEditStructure || planLocked}
        onNavigationContextChange={onNavigationContextChange}
        data={{
          identity: {
            ...(draft.trainingPlanId ? { programId: draft.trainingPlanId, programName: sourceProgramName ?? 'Программа' }
              : { programId: null, programName: null }),
            exerciseDefinitionId: activeExercise.exercise.exerciseDefinitionId,
            exerciseName: activeExercise.exercise.name,
            setNumber: activeSet.position + 1,
            workoutDate: localDate(start), sourceProgramSetId: activeSet.sourceProgramSetId,
            sessionSetId: null,
          },
          trackingType: editingSet.trackingType,
          setType: activeSet.setType ?? null,
          plan: { weightKg: activeSet.plannedWeightKg, reps: activeSet.plannedReps,
            durationSeconds: activeSet.plannedDurationSeconds, distanceMeters: activeSet.plannedDistanceMeters },
          previous: null, fact: null,
        }}
        onClose={() => setEditingSet(null)}
        onPlanSave={async input => {
          if (mutationBlocked()) throw new Error(access.current.planLocked ? lockedPlanMessage : 'План тренера доступен только для просмотра');
          if (!mayEditStructure) throw new Error('План тренера доступен только для просмотра');
          const writing = edit(current => ({
            ...current, plan: { ...current.plan,
              exercises: current.plan.exercises.map(ex => ex.id !== editingSet.exerciseId ? ex : ({
                ...ex, sets: ex.sets.map(set => set.id !== editingSet.setId ? set : ({
                  ...set,
                  plannedWeightKg: input.weightKg !== undefined ? input.weightKg : set.plannedWeightKg,
                  plannedReps: input.reps !== undefined ? input.reps : set.plannedReps,
                  plannedDurationSeconds: input.durationSeconds !== undefined ? input.durationSeconds : set.plannedDurationSeconds,
                  plannedDistanceMeters: input.distanceMeters !== undefined ? input.distanceMeters : set.plannedDistanceMeters,
                  setType: input.setType,
                })),
              })) },
          }));
          if (!writing) throw new Error('План тренировки недоступен для редактирования');
          await writing;
        }}
        onDeleteSet={mayEditStructure ? async () => {
          const writing = edit(current => ({
            ...current, plan: removeOccurrenceSet(current.plan, editingSet.exerciseId, editingSet.setId),
          }));
          if (!writing) throw new Error('Подход недоступен для удаления');
          await writing;
        } : undefined} /> : null}
      <MezfitDialog opened={programUpdateOpen} title={<Text variant="headline">Обновить этот день в программе?</Text>}
        buttons={<>
          <MezfitDialogButton disabled={busy} onClick={() => { void save(false); }}><Text variant="body">Нет</Text></MezfitDialogButton>
          <MezfitDialogButton strong disabled={busy} onClick={() => { void save(true); }}><Text variant="body">Да</Text></MezfitDialogButton>
        </>}>
        <Text variant="body">План запланированной тренировки сохранится в любом случае.</Text>
      </MezfitDialog>
      <MezfitDialog opened={deleteOpen} title={<Text variant="headline">Удалить черновик?</Text>}
        buttons={<>
          <MezfitDialogButton onClick={() => setDeleteOpen(false)}><Text variant="body">Отмена</Text></MezfitDialogButton>
          <MezfitDialogButton strong onClick={() => {
            if (mutationBlocked() || !draft || busy || starting.current) return;
            setBusy(true);
            void drafts.delete(draft.id).then(() => { setDeleteOpen(false); onClose(); })
              .catch(reason => setError(reason instanceof Error ? reason.message : 'Не удалось удалить'))
              .finally(() => setBusy(false));
          }}><Text variant="body">Удалить</Text></MezfitDialogButton>
        </>}>
        <Text variant="body">Несохранённые изменения будут потеряны.</Text>
      </MezfitDialog>
    </> : null}
  </>;
}

/** Keep the animated shell mounted closed before opening; reset each editor by ID. */
export function OccurrenceDraftSheet(props: OccurrenceDraftSheetProps) {
  const opened = props.draft !== null && !props.suspended;
  const sheetId = useId();
  const [retained, setRetained] = useState(props.draft);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [auxiliaryReady, setAuxiliaryReady] = useState(false);
  const openingFrame = useRef<number | null>(null);
  useEffect(() => { if (props.draft) setRetained(props.draft); }, [props.draft]);
  const draft = props.draft ?? retained;

  const finishOpening = useCallback(() => {
    if (openingFrame.current !== null) return;
    // Mount offscreen pickers after the completed transition has painted.
    openingFrame.current = window.requestAnimationFrame(() => {
      openingFrame.current = null;
      setAuxiliaryReady(true);
    });
  }, []);

  useEffect(() => {
    if (!opened) {
      setAuxiliaryReady(false);
      return;
    }
    if (!container) return;
    // No animated sheet (e.g. embedded/unanimated host): overlays can mount at once.
    const sheet = document.getElementById(sheetId);
    const duration = sheet ? openingTransitionDuration(sheet) : 0;
    if (duration === 0) {
      setAuxiliaryReady(true);
      return;
    }
    // Fallback for interrupted/missing transitionend in mobile WebViews.
    const timer = window.setTimeout(finishOpening, duration + 32);
    return () => {
      window.clearTimeout(timer);
      if (openingFrame.current !== null) {
        window.cancelAnimationFrame(openingFrame.current);
        openingFrame.current = null;
      }
    };
  }, [opened, container, finishOpening, sheetId]);

  return <><MezfitBottomSheet id={sheetId} opened={opened} label="Запланированная тренировка" lazyMount
    onTransitionEnd={(event) => {
      if (opened && event.target === event.currentTarget
        && (event.propertyName === 'transform' || event.propertyName === 'translate')) finishOpening();
    }}
    onClosed={() => { if (!props.draft) setRetained(null); props.onClosed?.(); }}>
    <div ref={setContainer} className="occurrence-draft-sheet__host" />
  </MezfitBottomSheet>
    {/* Form renders during slide; closed pickers/dialogs mount only after it finishes. */}
    {draft && container ? <OccurrenceDraftEditor key={draft.id} {...props} draft={draft}
      container={container} auxiliaryReady={opened && auxiliaryReady} /> : null}
  </>;
}

/** Inline scheduled occurrence; the owner supplies live or frozen PLAN and lock state. */
export function OccurrenceDraftCard({ collapsed, onCollapsedChange, ...props }: OccurrenceDraftCardProps) {
  return props.draft ? <OccurrenceDraftEditor key={props.draft.id} {...props}
    inlineCard collapsed={collapsed} onCollapsedChange={onCollapsedChange} auxiliaryReady /> : null;
}
