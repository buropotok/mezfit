import { MezfitLineChart, MezfitRadarChart } from './Charts';
import { Divider, Surface, Text } from './primitives';

const lineData = [
  { week: 'Н1', weight: 72, previous: 68 },
  { week: 'Н2', weight: 74, previous: 69 },
  { week: 'Н3', weight: 73, previous: 70 },
  { week: 'Н4', weight: 79, previous: 72 },
  { week: 'Н5', weight: 82, previous: 74 },
];

const radarData = [
  { dimension: 'Сила', now: 86, before: 71 },
  { dimension: 'Выносл.', now: 68, before: 59 },
  { dimension: 'Техника', now: 92, before: 77 },
  { dimension: 'Баланс', now: 74, before: 64 },
  { dimension: 'Подвижн.', now: 79, before: 69 },
];

export function ChartsCatalog() {
  return (
    <Surface as="section" className="ui-kit-section">
      <Text variant="title">Charts · Recharts</Text>
      <Text variant="caption" tone="muted">
        UI-only components. Data is illustrative, not sourced from workouts. The radar example uses a shared 0–100 scale.
      </Text>
      <Divider />
      <Text variant="headline">Line · two series</Text>
      <MezfitLineChart
        label="Пример изменения рабочего веса за пять недель"
        data={lineData}
        xKey="week"
        series={[{ dataKey: 'weight', name: 'Сейчас, кг' }, { dataKey: 'previous', name: 'Раньше, кг' }]}
      />
      <Divider />
      <Text variant="headline">Radar · normalized values</Text>
      <MezfitRadarChart
        label="Пример сравнительного профиля по пяти показателям"
        data={radarData}
        angleKey="dimension"
        domain={[0, 100]}
        series={[{ dataKey: 'now', name: 'Сейчас' }, { dataKey: 'before', name: 'Раньше' }]}
      />
      <Divider />
      <Text variant="headline">Empty states</Text>
      <MezfitLineChart label="Пустой линейный график" data={[]} xKey="week" series={[{ dataKey: 'weight', name: 'Вес' }]} />
      <MezfitRadarChart label="Пустая радарная диаграмма" data={[]} angleKey="dimension" series={[{ dataKey: 'value', name: 'Значение' }]} />
    </Surface>
  );
}
