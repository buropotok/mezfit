import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CloudContact } from '../data/cloud/CloudConnectionsProvider';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { AdHocWorkoutRepository, type ClientExerciseFact } from '../data/cloud/adhoc-workouts';
import { PUBLIC_EXERCISE_CATEGORIES } from '../data/exercises/publicExerciseFilters';
import type { NavigationContext } from '../NavigationShell';
import { ExerciseMedia } from '../ExerciseMedia';
import { ProgramExerciseInformationSheet } from '../program/ProgramExerciseInformationSheet';
import { TablerFilter } from '../exercises/TablerFilter';
import {
  Button, GlassSurface, IconButton, LiquidPopover, List, ListItem, Text,
} from '../ui';
import { MezfitRadarChart } from '../ui/Charts';
import { ClientExerciseStatisticsView } from '../coach/ClientExerciseStatisticsView';
import {
  filterFacts, periodBounds, periodOptions, radarCategories, shiftCalendarMonths, summarizeExercises,
  type ExercisePeriod,
} from '../coach/clientExerciseStatistics';
import { ProfileDataProvider, useProfileDataContext, useProfileSnapshot } from './ProfileDataProvider';
import '../coach/client-performed-exercises.css';

const EMPTY_FACTS: ClientExerciseFact[] = [];

const countLabel = (count: number) => {
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 14) return `${count} раз`;
  const mod10 = count % 10;
  return `${count} ${mod10 === 1 ? 'раз' : mod10 >= 2 && mod10 <= 4 ? 'раза' : 'раз'}`;
};
const displayCategory = (id: string) =>
  PUBLIC_EXERCISE_CATEGORIES.find(([key]) => key === id)?.[1] ?? 'Другое';

function shiftPeriod(period: ExercisePeriod, current: Date, direction: number, preferredDay = current.getDate()): {
  period: ExercisePeriod; date: Date;
} {
  if (period.startsWith('year:')) return { period: `year:${Number(period.slice(5)) + direction}`, date: current };
  if (period.startsWith('month:')) {
    const [year, month] = period.slice(6).split('-').map(Number);
    const next = new Date(year, month - 1 + direction, 1);
    return { period: `month:${next.getFullYear()}-${next.getMonth() + 1}`, date: current };
  }
  if (period === 'all') return { period, date: current };
  if (period === '30d') {
    const next = new Date(current);
    next.setDate(next.getDate() + 30 * direction);
    return { period, date: next };
  }
  const months = period === '3m' ? 3 : period === '6m' ? 6 : 12;
  return { period, date: shiftCalendarMonths(current, months * direction, preferredDay) };
}

/** Shared read-only FACT analytics for either a scoped Coach relationship or the athlete's own history. */
type PerformedExercisesProps = {
  /** Omitted for the signed-in athlete's personal profile. */
  client?: CloudContact;
  onDetailNavigationChange?: (context: NavigationContext | null) => void;
};

export function ClientPerformedExercisesPage(props: PerformedExercisesProps) {
  return useProfileDataContext() ? <PerformedExercises {...props} />
    : <ProfileDataProvider tab="exercises" contact={props.client}><PerformedExercises {...props} /></ProfileDataProvider>;
}

function PerformedExercises({ client, onDetailNavigationChange }: PerformedExercisesProps) {
  const cloud = useCloudConnections();
  const repository = useMemo(() => cloud
    ? new AdHocWorkoutRepository(cloud.db, cloud.actorUserId) : null,
  [cloud?.db, cloud?.actorUserId]);
  const { exercises, exerciseFilter, setExerciseFilter } = useProfileSnapshot();
  const facts = exercises.data ?? EMPTY_FACTS;
  const { period, anchor, anchorDay, category } = exerciseFilter;
  const [periodMenuOpen, setPeriodMenuOpen] = useState(false);
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [info, setInfo] = useState<ClientExerciseFact | null>(null);
  const [informationNavigation, setInformationNavigation] = useState<NavigationContext | null>(null);
  const periodTrigger = useRef<HTMLButtonElement>(null);
  const filterTrigger = useRef<HTMLButtonElement>(null);
  const infoLoad = useCallback(() => {
    if (!repository || !info) return Promise.reject(new Error('Упражнение недоступно'));
    return repository.exerciseInformation(info.sessionId, info.sessionExerciseId);
  }, [repository, info?.sessionId, info?.sessionExerciseId]);

  const allExercises = useMemo(() => summarizeExercises(facts), [facts]);
  const periodFacts = useMemo(() => filterFacts(facts, period, anchor), [facts, period, anchor]);
  const radar = useMemo(() => radarCategories(periodFacts), [periodFacts]);
  const list = useMemo(() => summarizeExercises(category
    ? periodFacts.filter(item => item.category === category) : periodFacts), [periodFacts, category]);
  const selected = allExercises.find(item => item.key === selectedKey);
  const detailFacts = useMemo(() => selectedKey
    ? periodFacts.filter(item => item.key === selectedKey) : [], [periodFacts, selectedKey]);
  const periodChoices = useMemo(() => periodOptions(facts), [facts]);
  const bounds = periodBounds(period, anchor);
  const rangeSuffix = period !== 'all' && !period.startsWith('year:') && !period.startsWith('month:')
    && Math.abs(anchor.getTime() - new Date().getTime()) > 86_400_000
    ? ` · до ${new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(anchor)}` : '';

  useEffect(() => {
    if (!onDetailNavigationChange) return undefined;
    const context = informationNavigation ?? (selected ? {
      title: selected.name,
      scrollKey: `client-exercise:${client?.relationshipId ?? cloud?.actorUserId ?? 'self'}:${selected.key}`,
      onBack: () => setSelectedKey(null),
    } : null);
    if (!context) return undefined;
    onDetailNavigationChange(context);
    return () => onDetailNavigationChange(null);
  }, [selected?.key, selected?.name, informationNavigation, client?.relationshipId, cloud?.actorUserId, onDetailNavigationChange]);

  const nextPeriod = shiftPeriod(period, anchor, 1, anchorDay);
  const nextBounds = periodBounds(nextPeriod.period, nextPeriod.date);
  const endOfToday = periodBounds('30d').end;
  const calendarPeriod = period.startsWith('year:') || period.startsWith('month:');
  const canGoForward = period !== 'all' && (calendarPeriod
    ? nextBounds.start < endOfToday
    : nextBounds.end <= endOfToday);
  const changePeriod = (direction: number) => {
    if (direction > 0 && !canGoForward) return;
    const next = direction > 0 ? nextPeriod : shiftPeriod(period, anchor, direction, anchorDay);
    setExerciseFilter(previous => ({ ...previous, period: next.period, anchor: next.date }));
  };

  return <div className="client-exercises">
    <div className="client-exercises__toolbar">
      <IconButton icon="chevron-left" label="Предыдущий период" disabled={period === 'all'}
        onClick={() => changePeriod(-1)} />
      <LiquidPopover isOpen={periodMenuOpen} onOpenChange={setPeriodMenuOpen}
        triggerRef={periodTrigger} label="Период статистики"
        items={periodChoices.map(option => ({
          id: option.value, label: option.label, active: period === option.value,
          onSelect: () => {
            const current = new Date();
            setExerciseFilter(previous => ({ ...previous, period: option.value, anchor: current, anchorDay: current.getDate() }));
          },
        }))}
        trigger={<IconButton ref={periodTrigger} label={`Период: ${bounds.label}`} icon="calendar" />} />
      <Text variant="body" className="client-exercises__period-label">{bounds.label}{rangeSuffix}</Text>
      <IconButton icon="chevron-right" label="Следующий период" disabled={!canGoForward}
        onClick={() => changePeriod(1)} />
    </div>

    {!exercises.data && !exercises.failed ? <Text variant="body" tone="muted">Загружаем упражнения…</Text> : null}
    {exercises.failed ? <GlassSurface component="section" preset="modalTuned" optics={false} blur={2}>
      <Text variant="body" role="alert">Не удалось {exercises.data ? 'обновить' : 'загрузить'} упражнения.</Text>
      <Button onClick={exercises.retry}>Повторить</Button>
    </GlassSurface> : null}

    {exercises.data && selected ? <>
      <ClientExerciseStatisticsView key={`${selected.key}:${selected.trackingType}`}
        trackingType={selected.trackingType} facts={detailFacts} />
    </> : null}
    {exercises.data && !selected ? <>
      <GlassSurface component="section" preset="modalTuned" optics={false} blur={2}
        className="client-exercises__radar" contentClassName="client-exercises__panel-content">
        <Text variant="headline">Выполнено упражнений</Text>
        {radar.length
          ? <MezfitRadarChart label="Распределение выполнений по категориям"
            data={radar} angleKey="label"
            series={[{ dataKey: 'count', name: 'Выполнений', color: 'var(--ui-color-primary)' }]} />
          : <Text variant="body" tone="muted">За выбранный период выполнений нет.</Text>}
      </GlassSurface>
      <GlassSurface component="section" preset="modalTuned" optics={false} blur={2}
        className="client-exercises__list-panel" contentClassName="client-exercises__panel-content">
        <div className="client-exercises__list-heading">
          <Text variant="headline">{category ? displayCategory(category) : 'Все категории'}</Text>
          <LiquidPopover isOpen={categoryMenuOpen} onOpenChange={setCategoryMenuOpen}
            triggerRef={filterTrigger} label="Фильтр упражнений по категории"
            items={[{ id: 'all', label: 'Все категории', active: category === null,
              onSelect: () => setExerciseFilter(previous => ({ ...previous, category: null })) },
            ...radar.map(item => ({
              id: item.category, label: item.label, active: category === item.category,
              onSelect: () => setExerciseFilter(previous => ({ ...previous, category: item.category })),
            }))]}
            trigger={<IconButton ref={filterTrigger} label="Фильтр по категориям"
              aria-pressed={category !== null}><TablerFilter /></IconButton>} />
        </div>
        {list.length
          ? <List className="client-exercises__list">{list.map(item => (
            <div className="client-exercises__row" key={item.key}>
              <ListItem leadingShape="square"
                leading={<ExerciseMedia exercise={{ id: item.key, name: item.name,
                  reference_source: null, reference_key: null }}
                  sourceUrl={item.mediaUrl} variant="thumbnail" />}
                title={item.name} trailing={countLabel(item.workouts)}
                trailingWidth="content" onClick={() => setSelectedKey(item.key)} />
              <button type="button" className="client-exercises__media-action"
                aria-label={`Информация об упражнении: ${item.name}`}
                onClick={() => setInfo(item.latest)} />
            </div>
          ))}</List>
          : <Text variant="body" tone="muted">{category
            ? 'В этой категории выполнений за выбранный период нет.'
            : 'В доступной истории пока нет выполненных упражнений за выбранный период.'}</Text>}
      </GlassSurface>
    </> : null}
    {info ? <ProgramExerciseInformationSheet key={info.sessionExerciseId}
      exerciseId={info.sessionExerciseId} load={infoLoad}
      onClose={() => setInfo(null)} onNavigationContextChange={setInformationNavigation} /> : null}
  </div>;
}
