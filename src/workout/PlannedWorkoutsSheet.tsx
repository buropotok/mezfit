import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from 'konsta/react';
import type { NavigationContext } from '../NavigationShell';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { PlannedWorkoutsRepository, type UpcomingPlannedWorkout } from '../data/cloud/planned-workouts';
import { WorkoutPlanningRepository } from '../data/cloud/workout-planning';
import type { LocalWorkoutOccurrenceDraft } from '../data/cloud/workout-occurrence-plan';
import type { ProgramActor } from '../program/ProgramSummary';
import { OccurrenceDraftCard } from '../schedule/OccurrenceDraftSheet';
import { MezfitBottomSheet, Text } from '../ui';
import { usePlannedWorkoutStart } from './PlannedWorkoutStartContext';
import './planned-workouts.css';

export function PlannedWorkoutsSheet({ opened, actor, onClose, onStarted, onNavigationContextChange }: {
  opened: boolean; actor?: ProgramActor; onClose: () => void; onStarted: (id: string) => void;
  onNavigationContextChange: (value: NavigationContext | null) => void;
}) {
  const cloud = useCloudConnections();
  const start = usePlannedWorkoutStart();
  const repository = useMemo(() => cloud ? new PlannedWorkoutsRepository(cloud.db, cloud.actorUserId) : null,
    [cloud?.db, cloud?.actorUserId]);
  const planner = useMemo(() => cloud ? new WorkoutPlanningRepository(cloud.db, cloud.actorUserId) : null,
    [cloud?.db, cloud?.actorUserId]);
  const [rows, setRows] = useState<UpcomingPlannedWorkout[]>([]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const visit = useRef(0);
  const alive = useRef(false);
  const isOpen = useRef(opened);
  isOpen.current = opened;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    ++visit.current;
    if (!opened || !repository) return;
    let active = true;
    setLoading(true); setError(''); setRows([]); setExpanded(new Set());
    const subscription = repository.observe(new Date(), value => {
      if (active) { setRows(value); setLoading(false); setError(''); }
    }, reason => {
      if (active) { setLoading(false); setError(reason instanceof Error ? reason.message : 'Не удалось прочитать плановые тренировки'); }
    });
    return () => { ++visit.current; active = false; subscription.unsubscribe(); };
  }, [opened, repository, retry]);
  const save = useCallback(async (draft: LocalWorkoutOccurrenceDraft, updateProgram: boolean) => {
    if (!planner || !repository) throw new Error('Сохранение недоступно');
    const current = await repository.drafts.get(draft.id);
    if (!current) throw new Error('Тренировка недоступна');
    await planner.publish(current.id);
    if (updateProgram && current.trainingPlanId && current.programDayId)
      await planner.programs.applyOccurrencePlan(current.trainingPlanId, current.programDayId, current.plan, current.originalPlan);
  }, [planner, repository]);
  return <MezfitBottomSheet opened={opened} label="Плановая тренировка" lazyMount>
    <section className="planned-workouts">
      <header className="planned-workouts__header">
        <Text variant="headline">Плановая тренировка</Text>
        <Button clear inline onClick={onClose}>Закрыть</Button>
      </header>
      <Text variant="body">Выберите запланированный день и настройте план.</Text>
      {loading ? <Text variant="body" role="status">Загружаем тренировки…</Text> : null}
      {error ? <><Text variant="footnote" role="alert">{error}</Text>
        <Button rounded tonal onClick={() => setRetry(value => value + 1)}>Повторить</Button></> : null}
      {!loading && !error && !rows.length ? <Text variant="body">На ближайшие две недели тренировок нет.</Text> : null}
      {repository ? rows.map(row => <OccurrenceDraftCard key={row.id} draft={row.draft} drafts={repository.drafts}
        actor={actor} sourceProgramName={row.programName} collapsed={!expanded.has(row.id)}
        onCollapsedChange={() => setExpanded(current => {
          const next = new Set(current);
          if (next.has(row.id)) next.delete(row.id); else next.add(row.id);
          return next;
        })}
        onStart={start ? async draft => {
          const token = visit.current;
          const id = await start.start(draft);
          if (token === visit.current && alive.current && isOpen.current) { onStarted(id); start.showSession(id); }
        } : undefined}
        onSave={save} onClose={onClose} onNavigationContextChange={onNavigationContextChange} />) : null}
    </section>
  </MezfitBottomSheet>;
}
