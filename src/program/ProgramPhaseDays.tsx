import { useSpotlightHintPause } from '../ui/SpotlightHint';
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { NavigationContext } from '../NavigationShell';
import type { CloudProgramDayOutline, CloudProgramPhaseRow } from '../data/cloud/workout-foundation-types';
import type { ProgramManagementRepository } from '../data/cloud/program-management';
import type { CloudTrainingPlanRow } from '../data/cloud/database';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { planAuthorUserId } from '../data/cloud/program-ownership';
import { CloudContactAvatar } from '../contacts/CloudContactAvatar';
import { Avatar, Text } from '../ui';
import { WorkoutSessionCard } from '../workout/WorkoutSessionCard';
import { SetEntry } from '../workout/SetEntry';
import { ProgramDayDialog } from './ProgramDayDialog';
import { WorkoutPlanningRepository } from '../data/cloud/workout-planning';
import type { WorkoutScheduleFormat } from '../data/cloud/workout-scheduling-types';
import { useSchedulePlanning } from '../schedule/SchedulePlanningContext';
import { PlanActionDialog } from './PlanActionDialog';
import type { ProgramActor } from './ProgramSummary';
import { usePhaseDayMotion } from './usePhaseDayMotion';
import { ProgramDayExercisePicker } from './ProgramDayExercisePicker';
import { programMutationMessage } from './programPresentation';

const ProgramExerciseInformationSheet = lazy(() => import('./ProgramExerciseInformationSheet')
  .then(module => ({ default: module.ProgramExerciseInformationSheet })));

export function ProgramPhaseDays({ repository, program, days, readOnly, actor, collapsed = false, bodyId, onNavigationContextChange, viewerRole = 'coach', phaseStatus = 'draft', onActivateForScheduling, onMutationAttempt }: {
  onMutationAttempt?: () => void;
  onActivateForScheduling?: (phaseId: string, onActivated: () => Promise<void>) => void;
  repository: ProgramManagementRepository;
  program: CloudTrainingPlanRow;
  days: readonly CloudProgramDayOutline[];
  readOnly: boolean;
  actor?: ProgramActor;
  collapsed?: boolean;
  bodyId?: string;
  viewerRole?: 'coach' | 'client';
  phaseStatus?: CloudProgramPhaseRow['status'];
  onNavigationContextChange?: (context: NavigationContext | null) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [exerciseDayId, setExerciseDayId] = useState<string | null>(null);
  const [exerciseInformation, setExerciseInformation] = useState<{ dayId: string; exerciseId: string } | null>(null);
  useSpotlightHintPause(exerciseInformation !== null);
  const [deletingExercise, setDeletingExercise] = useState<{ dayId: string; exerciseId: string } | null>(null);
  const [deletingSet, setDeletingSet] = useState<{ dayId: string; exerciseId: string; setId: string } | null>(null);
  const [editingSet, setEditingSet] = useState<{ dayId: string; exerciseId: string; setId: string } | null>(null);
  const [optimisticExerciseOrders, setOptimisticExerciseOrders] = useState<Record<string, { previous: string[]; next: string[] }>>({});
  const cloud = useCloudConnections();
  const planning = useSchedulePlanning();
  const authorId = planAuthorUserId(program);
  const self = authorId === repository.actorUserId;
  const contact = (self ? cloud?.selfAvatars ?? [] : [...(cloud?.clients ?? []), ...(cloud?.coaches ?? [])])
    .find(person => person.userId === authorId && person.relationshipId === program.realmId
      && (!self || Boolean(person.avatarVersion)));
  const creatorName = self ? actor?.name || 'Вы' : contact?.displayName || 'Автор программы';
  const creatorAvatar = contact ? <CloudContactAvatar contact={contact} />
    : <Avatar name={creatorName} src={self ? actor?.photoUrl ?? undefined : undefined} />;
  const [dialog, setDialog] = useState<{ kind: 'edit' | 'comment' | 'delete'; item: CloudProgramDayOutline } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);
  const alive = useRef(true);
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const positions = useRef(new Map<string, number>());
  const previousOrder = useRef('');
  const animations = useRef<Animation[]>([]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; animations.current.forEach((animation) => animation.cancel()); };
  }, []);
  usePhaseDayMotion(collapsed, viewport, content, nodes);
  useEffect(() => {
    setOptimisticExerciseOrders((current) => {
      const next = { ...current };
      for (const [dayId, order] of Object.entries(current)) {
        const day = days.find((item) => item.day.id === dayId);
        const actual = day?.exercises.map((item) => item.exercise.id);
        // Any canonical change (including a concurrent reorder) supersedes the preview.
        if (!actual || actual.length !== order.previous.length
          || actual.some((id, index) => id !== order.previous[index])) delete next[dayId];
      }
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [days]);
  const displayDays = days.map((item) => {
    const order = optimisticExerciseOrders[item.day.id];
    if (!order) return item;
    const positions = new Map(order.next.map((id, index) => [id, index]));
    return { ...item, exercises: [...item.exercises].sort((a, b) =>
      (positions.get(a.exercise.id) ?? a.exercise.position) - (positions.get(b.exercise.id) ?? b.exercise.position)) };
  });
  const orderKey = days.map((row) => row.day.id).join('|');
  // Animate only our own day wrappers; no access to UI Kit/private DOM or DnD sensors.
  useLayoutEffect(() => {
    const next = new Map<string, number>();
    // Layout offsets exclude scroll and in-flight transforms. Refresh after
    // metadata/comment changes too, so the next move uses current card heights.
    for (const [id, node] of nodes.current) next.set(id, node.offsetTop);
    const reordered = previousOrder.current !== orderKey;
    if (reordered) {
      animations.current.forEach((animation) => animation.cancel());
      animations.current = [];
    }
    if (reordered && !collapsed && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      for (const [id, top] of next) {
        const previous = positions.current.get(id), node = nodes.current.get(id);
        if (previous !== undefined && previous !== top && node?.animate) {
          animations.current.push(node.animate([
            { transform: `translateY(${previous - top}px)` }, { transform: 'translateY(0)' },
          ], { duration: 240, easing: 'ease-in-out' }));
        }
      }
    }
    positions.current = next;
    previousOrder.current = orderKey;
  });
  const run = async (task: () => Promise<unknown>) => {
    if (running.current || readOnly) return;
    running.current = true;
    setBusy(true);
    setError('');
    try { await task(); }
    catch (reason) { if (alive.current) setError(programMutationMessage(reason)); }
    finally { running.current = false; if (alive.current) setBusy(false); }
  };
  const schedule = async (item: CloudProgramDayOutline, format: WorkoutScheduleFormat, activated = false) => {
    if (running.current || !alive.current || !cloud || !planning) return;
    if (!activated && (program.status !== 'active' || phaseStatus !== 'active')) {
      onActivateForScheduling?.(item.day.programPhaseId, () => schedule(item, format, true));
      return;
    }
    running.current = true;
    setBusy(true);
    setError('');
    const planner = new WorkoutPlanningRepository(cloud.db, repository.actorUserId);
    try {
      const fresh = activated ? await repository.details(program.id) : null;
      if (!alive.current) return;
      const source = fresh?.program ?? program;
      const sourceDay = activated ? fresh?.days?.find(day => day.day.id === item.day.id) : item;
      const sourcePhase = activated ? fresh?.phases.find(phase => phase.id === item.day.programPhaseId)?.status : phaseStatus;
      if (!sourceDay || source.status !== 'active' || sourcePhase !== 'active')
        throw new Error('Программа и фаза должны быть активны для планирования');
      const id = await planner.createFromProgramDay(source, sourceDay, format, sourcePhase);
      if (alive.current) planning.openDraft(id, format === 'independent' && program.clientUserId ? program.clientUserId : null);
    } catch (reason) {
      if (alive.current) setError(programMutationMessage(reason));
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const selected = dialog?.item.day;
  return <>
    <div ref={viewport} id={bodyId} className="cloud-plan-days-viewport" aria-hidden={collapsed} inert={collapsed}>
    <div ref={content} className="cloud-plan-days">
    {error ? <Text variant="footnote" role="alert">{error}</Text> : null}
    {displayDays.map((item, index) => <div key={item.day.id}
      style={{ position: 'relative', zIndex: days.length - index }}
      ref={(node) => { if (node) nodes.current.set(item.day.id, node); else nodes.current.delete(item.day.id); }}>
      <WorkoutSessionCard mode="planning" day={item} programName={program.name}
        onReorderExercises={(ids) => {
          if (running.current || readOnly) return;
          setOptimisticExerciseOrders((current) => ({ ...current, [item.day.id]: {
            previous: item.exercises.map((entry) => entry.exercise.id), next: ids,
          } }));
          void run(async () => {
            try { await repository.reorderDayExercises(program.id, item.day.id, ids); }
            catch (reason) {
              if (alive.current) setOptimisticExerciseOrders((current) => {
                if (current[item.day.id]?.next !== ids) return current;
                const next = { ...current };
                delete next[item.day.id];
                return next;
              });
              throw reason;
            }
          });
        }} creatorName={creatorName} creatorAvatar={creatorAvatar}
        readOnly={readOnly} onMutationAttempt={onMutationAttempt} busy={busy || exerciseDayId !== null}
        canScheduleCoached={viewerRole === 'coach' && program.coachUserId === repository.actorUserId
          && program.clientUserId !== null} onSchedule={planning && ((program.status === 'active' && phaseStatus === 'active') || (!readOnly && onActivateForScheduling)) ? format => { void schedule(item, format); } : undefined} canMoveUp={index > 0} canMoveDown={index < days.length - 1}
        onAddExercise={() => setExerciseDayId(item.day.id)}
        onAddSet={(exerciseId) => { void run(() => repository.addExerciseSet(program.id, item.day.id, exerciseId)); }}
        onOpenSet={!readOnly ? (exerciseId, setId) => {
          const source = item.exercises.find(entry => entry.exercise.id === exerciseId);
          if (!source) return;
          void repository.trackingTypeForExercise(source.exercise.exercise).then(type => {
            if (!alive.current) return;
            if (type === 'weight_reps') setEditingSet({ dayId: item.day.id, exerciseId, setId });
            else setError('Сейчас доступен ввод только для упражнений «Вес + повторения»');
          }).catch(reason => { if (alive.current) setError(programMutationMessage(reason)); });
        } : undefined}
        onDeleteSet={!readOnly ? (exerciseId, setId) => setDeletingSet({ dayId: item.day.id, exerciseId, setId }) : undefined}
        onDeleteExercise={!readOnly ? exerciseId => setDeletingExercise({ dayId: item.day.id, exerciseId }) : undefined}
        onExerciseInformation={exerciseId => setExerciseInformation({ dayId: item.day.id, exerciseId })}
        onEdit={() => setDialog({ kind: 'edit', item })}
        onComment={() => setDialog({ kind: 'comment', item })}
        onDelete={() => setDialog({ kind: 'delete', item })}
        onMove={(direction) => { void run(() => repository.moveDay(program.id, item.day.id, direction)); }}
        onDuplicate={() => { void run(() => repository.duplicateDay(program.id, item.day.id)); }} />
    </div>)}
    </div>
    </div>
    {editingSet && (() => {
      const day = days.find(entry => entry.day.id === editingSet.dayId);
      const source = day?.exercises.find(entry => entry.exercise.id === editingSet.exerciseId);
      const set = source?.sets.find(entry => entry.id === editingSet.setId);
      if (!set || !source) return null;
      return <SetEntry key={set.id} mode="program-plan" isOpen
        onNavigationContextChange={onNavigationContextChange}
        data={{
          identity: { programId: program.id, programName: program.name,
            exerciseDefinitionId: source.exercise.exercise.exerciseDefinitionId,
            exerciseName: source.exercise.exercise.name, setNumber: set.position + 1,
            workoutDate: '', sourceProgramSetId: set.id, sessionSetId: null },
          trackingType: 'weight_reps',
          setType: set.setType ?? null,
          plan: { weightKg: set.plannedWeightKg, reps: set.plannedReps,
            durationSeconds: null, distanceMeters: null },
          previous: null, fact: null,
        }}
        onClose={() => setEditingSet(null)}
        onPlanSave={input => repository.updateExerciseSet(program.id, editingSet.dayId,
          editingSet.exerciseId, editingSet.setId, input)} />;
    })()}
    {!readOnly ? <ProgramDayExercisePicker repository={repository} program={program}
      dayId={exerciseDayId} catalogueRole={viewerRole} onNavigationContextChange={onNavigationContextChange} onClose={() => setExerciseDayId(null)} /> : null}
    {dialog && selected && dialog.kind !== 'delete' ? <ProgramDayDialog key={`${dialog.kind}:${selected.id}`}
      title={dialog.kind === 'edit' ? 'Изменить день' : 'Комментарий к тренировке'}
      name={selected.name} comment={selected.comment ?? ''}
      commentOnly={dialog.kind === 'comment'} onClose={() => setDialog(null)}
      onSave={(value) => dialog.kind === 'comment'
        ? repository.commentDay(program.id, selected.id, value.comment)
        : repository.editDay(program.id, selected.id, value.name, selected.category ?? '')} /> : null}
    {exerciseInformation ? <Suspense fallback={<Text variant="footnote">Загружаем информацию…</Text>}><ProgramExerciseInformationSheet key={exerciseInformation.exerciseId}
      repository={repository} programId={program.id} {...exerciseInformation}
      onClose={() => setExerciseInformation(null)} onNavigationContextChange={onNavigationContextChange} /></Suspense> : null}
    <PlanActionDialog onClose={() => setDeletingSet(null)} dialog={deletingSet ? {
      kind: 'confirm', title: 'Удалить подход?', confirmLabel: 'Удалить', destructive: true,
      description: 'Подход будет удалён из программы. История выполненных тренировок сохранится.',
      onConfirm: async () => {
        await repository.deleteExerciseSet(program.id, deletingSet.dayId, deletingSet.exerciseId, deletingSet.setId);
        if (alive.current) setDeletingSet(null);
      },
    } : null} />
    <PlanActionDialog onClose={() => setDeletingExercise(null)} dialog={deletingExercise ? {
      kind: 'confirm', title: 'Удалить упражнение?', confirmLabel: 'Удалить', destructive: true,
      description: 'Упражнение будет удалено из этого дня программы. История тренировок сохранится.',
      onConfirm: async () => {
        await repository.deleteDayExercise(program.id, deletingExercise.dayId, deletingExercise.exerciseId);
        if (alive.current) setDeletingExercise(null);
      },
    } : null} />
    <PlanActionDialog onClose={() => setDialog(null)} dialog={dialog?.kind === 'delete' && selected ? {
      kind: 'confirm', title: 'Удалить день?', confirmLabel: 'Удалить', destructive: true,
      description: 'День будет удалён из программы. История выполненных тренировок сохранится.',
      onConfirm: async () => {
        await repository.deleteDay(program.id, selected.id);
        if (alive.current) setDialog(null);
      },
    } : null} />
  </>;
}
