import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Toast } from 'konsta/react';
import type { NavigationContext } from '../NavigationShell';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { PlannedWorkoutsRepository, type UpcomingPlannedWorkout } from '../data/cloud/planned-workouts';
import { WorkoutPlanningRepository } from '../data/cloud/workout-planning';
import type { LocalWorkoutOccurrenceDraft } from '../data/cloud/workout-occurrence-plan';
import type { ProgramActor } from '../program/ProgramSummary';
import { OccurrenceDraftCard, useOccurrenceDraftClose } from '../schedule/OccurrenceDraftSheet';
import { MezfitBottomSheet, Text } from '../ui';
import { usePlannedWorkoutStart } from './PlannedWorkoutStartContext';
import './planned-workouts.css';

export function PlannedWorkoutsSheet({ opened, actor, onClose, onStarted, onNavigationContextChange, onError }: {
  opened: boolean; actor?: ProgramActor; onClose: () => void; onStarted: (id: string) => void;
  onNavigationContextChange: (value: NavigationContext | null) => void;
  onError?: (message: string) => void;
}) {
  const cloud = useCloudConnections();
  const start = usePlannedWorkoutStart();
  const repository = useMemo(() => cloud ? new PlannedWorkoutsRepository(cloud.db, cloud.actorUserId) : null,
    [cloud?.db, cloud?.actorUserId]);
  const planner = useMemo(() => cloud ? new WorkoutPlanningRepository(cloud.db, cloud.actorUserId) : null,
    [cloud?.db, cloud?.actorUserId]);
  const [rows, setRows] = useState<UpcomingPlannedWorkout[]>([]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [editingRows, setEditingRows] = useState<UpcomingPlannedWorkout[]>([]);
  const visitedIds = useRef(new Set<string>());
  const editorFlushers = useRef(new Map<string, { current: (() => Promise<void>) | null }>());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const visit = useRef(0);
  const alive = useRef(false);
  const pendingCancel = useRef<string | null>(null);
  const activeRepository = useRef(repository);
  activeRepository.current = repository;
  useEffect(() => { pendingCancel.current = null; }, [repository]);
  const isOpen = useRef(opened);
  isOpen.current = opened;
  useEffect(() => { alive.current = true; return () => { alive.current = false; pendingCancel.current = null; }; }, []);
  useEffect(() => {
    ++visit.current;
    if (!opened || !repository) return;
    let active = true;
    setLoading(true); setError(''); setRows([]); setExpanded(new Set()); setEditingRows([]); visitedIds.current.clear(); editorFlushers.current.clear();
    const subscription = repository.observe(new Date(), value => {
      if (active) { setRows(value); setLoading(false); setError(''); }
    }, reason => {
      if (active) { setLoading(false); setError(reason instanceof Error ? reason.message : 'Не удалось прочитать плановые тренировки'); }
    });
    return () => { ++visit.current; active = false; subscription.unsubscribe(); };
  }, [opened, repository, retry]);
  const editingIds = JSON.stringify(editingRows.map(row => row.draft.id));
  useEffect(() => {
    if (!opened || !repository) return;
    let active = true;
    const ids: string[] = JSON.parse(editingIds);
    const subscriptions = ids.map(id => repository.observeDraft(id, draft => {
      if (!active) return;
      setEditingRows(current => current.flatMap(row => row.draft.id !== id ? [row]
        : draft && !draft.workoutSessionId && (!draft.executionStatus || draft.executionStatus === 'scheduled')
          ? [{ ...row, draft }] : []));
    }, reason => {
      if (active) setError(reason instanceof Error ? reason.message : 'Не удалось прочитать тренировку');
    }));
    return () => { active = false; subscriptions.forEach(subscription => subscription.unsubscribe()); };
  }, [opened, repository, editingIds]);
  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(''), 4000);
    return () => window.clearTimeout(timer);
  }, [error]);
  useEffect(() => {
    if (!opened || !start?.conflictActive) return;
    onNavigationContextChange({ level: 2, title: 'Конфликт тренировок', contentMode: 'viewport', onBack: start.dismissConflict });
    return () => onNavigationContextChange(null);
  }, [opened, start?.conflictActive, start?.dismissConflict, onNavigationContextChange]);
  const save = useCallback(async (draft: LocalWorkoutOccurrenceDraft, updateProgram: boolean) => {
    if (!planner || !repository) throw new Error('Сохранение недоступно');
    const current = await repository.drafts.get(draft.id);
    if (!current) throw new Error('Тренировка недоступна');
    await planner.publish(current.id);
    if (updateProgram && current.trainingPlanId && current.programDayId)
      await planner.programs.applyOccurrencePlan(current.trainingPlanId, current.programDayId, current.plan, current.originalPlan);
  }, [planner, repository]);
  const { requestClose, closeDialog } = useOccurrenceDraftClose({ drafts: repository?.drafts ?? null,
    getIds: () => [...visitedIds.current], onSave: save, onClose, enabled: opened,
    scope: cloud?.actorUserId, beforeClose: async () => {
      for (const flush of editorFlushers.current.values()) await flush.current?.();
    } });
  const displayedRows = rows.map(row => editingRows.find(editing => editing.id === row.id) ?? row)
    .concat(editingRows.filter(editing => !rows.some(row => row.id === editing.id)));
  return <><MezfitBottomSheet opened={opened && !start?.conflictActive} label="Плановая тренировка" lazyMount onClosed={() => {
    const id = pendingCancel.current; pendingCancel.current = null;
    if (!id || !repository) return;
    const current = repository;
    void (start ? start.cancel(id) : repository.drafts.cancel(id)).catch(reason => {
      if (alive.current && activeRepository.current === current) onError?.(reason instanceof Error ? reason.message : 'Не удалось отменить тренировку');
    });
  }}>
    <section className="planned-workouts">
      <header className="planned-workouts__header">
        <Text variant="headline">Плановая тренировка</Text>
        <Button clear inline onClick={requestClose}>Закрыть</Button>
      </header>
      <Text variant="body">Выберите запланированный день и настройте план.</Text>
      {loading ? <Text variant="body" role="status">Загружаем тренировки…</Text> : null}
      {error ? <Button rounded tonal onClick={() => setRetry(value => value + 1)}>Повторить</Button> : null}
      {!loading && !error && !displayedRows.length ? <Text variant="body">На ближайшие две недели тренировок нет.</Text> : null}
      {repository ? displayedRows.map(row => {
        let flush = editorFlushers.current.get(row.draft.id);
        if (!flush) { flush = { current: null }; editorFlushers.current.set(row.draft.id, flush); }
        return <OccurrenceDraftCard key={row.id} draft={row.draft} drafts={repository.drafts}
        flushEditsRef={flush} actor={actor} sourceProgramName={row.programName} collapsed={!expanded.has(row.id)}
        onCollapsedChange={() => {
          const next = new Set(expanded);
          if (next.has(row.id)) {
            next.delete(row.id);
            setEditingRows(current => current.filter(editing => editing.id !== row.id));
          } else {
            next.add(row.id); visitedIds.current.add(row.draft.id);
            setEditingRows(current => [...current.filter(editing => editing.id !== row.id), row]);
          }
          setExpanded(next);
        }}
        onStart={start ? async draft => {
          const token = visit.current;
          const id = await start.start(draft);
          if (token === visit.current && alive.current && isOpen.current) { onStarted(id); start.showSession(id); }
        } : undefined}
        onCancel={draft => { pendingCancel.current = draft.targetOccurrenceId ?? draft.id.slice(6); onClose(); }}
        onDelete={async draft => {
          const token = visit.current;
          await repository.drafts.deactivate(draft.targetOccurrenceId ?? draft.id.slice(6));
          if (alive.current && token === visit.current && isOpen.current) onClose();
        }}
        onSave={save} onClose={onClose} onNavigationContextChange={onNavigationContextChange} />;
      }) : null}
    </section>
  </MezfitBottomSheet>
    {closeDialog}
    {error ? <Toast opened position="bottom" role="alert"><Text variant="body">{error}</Text></Toast> : null}
  </>;
}
