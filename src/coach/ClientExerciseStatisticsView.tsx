import { useMemo, useRef, useState } from 'react';
import type { ClientExerciseFact } from '../data/cloud/adhoc-workouts';
import { GlassSurface, IconButton, LiquidPopover, Text } from '../ui';
import { MezfitLineChart } from '../ui/Charts';
import {
  exerciseMetric, maxSetReps, maxWorkoutVolume, metricChoices, metricSeries,
  type ExerciseMetric,
} from './clientExerciseStatistics';

const formatNumber = (value: number): string =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value);

function MetricTile({ label, value, unit = '' }: { label: string; value: number; unit?: string }) {
  return <GlassSurface component="article" preset="modalTuned" optics={false} blur={2}
    className="client-exercises__metric-tile" contentClassName="client-exercises__metric-content">
    <Text variant="footnote" tone="muted">{label}</Text>
    <Text variant="title">{formatNumber(value)}{unit ? ` ${unit}` : ''}</Text>
  </GlassSurface>;
}

export function ClientExerciseStatisticsView({ facts, trackingType }: {
  facts: readonly ClientExerciseFact[];
  trackingType: ClientExerciseFact['trackingType'];
}) {
  const options = metricChoices(trackingType);
  const [metric, setMetric] = useState<ExerciseMetric>(options[0].id);
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const data = useMemo(() => metricSeries(facts, metric), [facts, metric]);
  const tiles: Array<{ label: string; value: number; unit?: string }> = [
    { label: 'Всего тренировок', value: exerciseMetric(facts, 'workouts') },
    { label: 'Всего подходов', value: exerciseMetric(facts, 'sets') },
  ];
  if (trackingType === 'weight_reps') tiles.unshift(
    { label: 'Расчётный разовый максимум', value: exerciseMetric(facts, 'oneRepMax'), unit: 'кг' },
    { label: 'Макс. объём тренировки', value: maxWorkoutVolume(facts), unit: 'кг' },
    { label: 'Макс. вес', value: exerciseMetric(facts, 'weight'), unit: 'кг' },
    { label: 'Макс. число повторений', value: maxSetReps(facts) },
    { label: 'Всего повторений', value: exerciseMetric(facts, 'reps') },
    { label: 'Общий объём тренировок', value: exerciseMetric(facts, 'volume'), unit: 'кг' },
  );
  if (trackingType === 'time_reps') tiles.unshift(
    { label: 'Всего повторений', value: exerciseMetric(facts, 'reps') },
  );
  if (trackingType === 'time' || trackingType === 'time_reps'
    || trackingType === 'time_weight' || trackingType === 'time_distance') {
    tiles.unshift({ label: 'Общее время', value: exerciseMetric(facts, 'duration'), unit: 'с' });
  }
  if (trackingType === 'time_weight') tiles.unshift(
    { label: 'Макс. вес', value: exerciseMetric(facts, 'weight'), unit: 'кг' },
  );
  if (trackingType === 'time_distance') tiles.unshift(
    { label: 'Общая дистанция', value: exerciseMetric(facts, 'distance'), unit: 'м' },
  );

  return <div className="client-exercises__stats">
    <GlassSurface component="section" preset="modalTuned" optics={false} blur={2}
      className="client-exercises__chart-panel" contentClassName="client-exercises__panel-content">
      <div className="client-exercises__chart-heading">
        <Text variant="headline">Динамика показателей</Text>
        <LiquidPopover isOpen={menuOpen} onOpenChange={setMenuOpen}
          triggerRef={triggerRef} label="Показатель графика"
          items={options.map(option => ({
            id: option.id, label: option.label, active: metric === option.id,
            onSelect: () => setMetric(option.id),
          }))}
          trigger={<IconButton ref={triggerRef} label="Выбрать показатель графика" icon="dots-vertical" />} />
      </div>
      {data.length
        ? <MezfitLineChart label="Динамика упражнения" data={data} xKey="day"
          series={[{ dataKey: 'value', name: options.find(option => option.id === metric)?.label ?? 'Значение',
            color: 'var(--ui-color-primary)' }]} />
        : <Text variant="body" tone="muted">За выбранный период результатов нет.</Text>}
    </GlassSurface>
    <div className="client-exercises__metrics">
      {tiles.map(item => <MetricTile key={item.label} {...item} />)}
    </div>
  </div>;
}
