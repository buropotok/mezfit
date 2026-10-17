import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { NavigationContext } from '../NavigationShell';
import type { CloudProgramDayOutline } from '../data/cloud/workout-foundation-types';
import type { ProgramManagementRepository } from '../data/cloud/program-management';
import type { CloudTrainingPlanRow } from '../data/cloud/database';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { planAuthorUserId } from '../data/cloud/program-ownership';
import { CloudContactAvatar } from '../contacts/CloudContactAvatar';
import { Avatar, Text } from '../ui';
import { WorkoutSessionCard } from '../workout/WorkoutSessionCard';
import { ProgramDayDialog } from './ProgramDayDialog';
import { PlanActionDialog } from './PlanActionDialog';
import type { ProgramActor } from './ProgramSummary';
import { usePhaseDayMotion } from './usePhaseDayMotion';
import { ProgramDayExercisePicker } from './ProgramDayExercisePicker';
import { programMutationMessage } from './programPresentation';

export function ProgramPhaseDays({ repository, program, days, readOnly, actor, collapsed = false, bodyId, onNavigationContextChange, viewerRole = 'coach' }: {
  repository: ProgramManagementRepository;
  program: CloudTrainingPlanRow;
  days: readonly CloudProgramDayOutline[];
  readOnly: boolean;
  actor?: ProgramActor;
  collapsed?: boolean;
  bodyId?: string;
  viewerRole?: 'coach' | 'client';
  onNavigationContextChange?: (context: NavigationContext | null) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [exerciseDayId, setExerciseDayId] = useState<string | null>(null);
  const cloud = useCloudConnections();
  const authorId = planAuthorUserId(program);
  const self = authorId === repository.actorUserId;
  const contact = [...(cloud?.clients ?? []), ...(cloud?.coaches ?? [])].find((person) =>
    person.userId === authorId && person.relationshipId === program.realmId);
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
  const selected = dialog?.item.day;
  return <>
    <div ref={viewport} id={bodyId} className="cloud-plan-days-viewport" aria-hidden={collapsed} inert={collapsed}>
    <div ref={content} className="cloud-plan-days">
    {error ? <Text variant="footnote" role="alert">{error}</Text> : null}
    {days.map((item, index) => <div key={item.day.id}
      style={{ position: 'relative', zIndex: days.length - index }}
      ref={(node) => { if (node) nodes.current.set(item.day.id, node); else nodes.current.delete(item.day.id); }}>
      <WorkoutSessionCard mode="planning" day={item} programName={program.name}
        onReorderExercises={(ids) => { void run(() => repository.reorderDayExercises(program.id, item.day.id, ids)); }} creatorName={creatorName} creatorAvatar={creatorAvatar}
        readOnly={readOnly} busy={busy || exerciseDayId !== null} canMoveUp={index > 0} canMoveDown={index < days.length - 1}
        onAddExercise={() => setExerciseDayId(item.day.id)}
        onAddSet={(exerciseId) => { void run(() => repository.addExerciseSet(program.id, item.day.id, exerciseId)); }}
        onEdit={() => setDialog({ kind: 'edit', item })}
        onComment={() => setDialog({ kind: 'comment', item })}
        onDelete={() => setDialog({ kind: 'delete', item })}
        onMove={(direction) => { void run(() => repository.moveDay(program.id, item.day.id, direction)); }}
        onDuplicate={() => { void run(() => repository.duplicateDay(program.id, item.day.id)); }} />
    </div>)}
    </div>
    </div>
    {!readOnly ? <ProgramDayExercisePicker repository={repository} program={program}
      dayId={exerciseDayId} catalogueRole={viewerRole} onNavigationContextChange={onNavigationContextChange} onClose={() => setExerciseDayId(null)} /> : null}
    {dialog && selected && dialog.kind !== 'delete' ? <ProgramDayDialog key={`${dialog.kind}:${selected.id}`}
      title={dialog.kind === 'edit' ? 'Изменить день' : 'Комментарий к тренировке'}
      name={selected.name} comment={selected.comment ?? ''}
      commentOnly={dialog.kind === 'comment'} onClose={() => setDialog(null)}
      onSave={(value) => dialog.kind === 'comment'
        ? repository.commentDay(program.id, selected.id, value.comment)
        : repository.editDay(program.id, selected.id, value.name, selected.category ?? '')} /> : null}
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
