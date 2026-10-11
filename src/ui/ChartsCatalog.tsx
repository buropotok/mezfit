import { MezfitLineChart, MezfitRadarChart } from './Charts';
import { Divider, Surface, Text } from './primitives';

const progress = [
  { week: 'Н1', current: 72, previous: 68 },
  { week: 'Н2', current: 74, previous: 69 },
  { week: 'Н3', current: 73, previous: 70 },
  { week: 'Н4', current: 79, previous: 72 },
];

const profile = [
  { axis: 'Сила', current: 86, previous: 71 },
  { axis: 'Техника', current: 92, previous: 77 },
  { axis: 'Баланс', current: 74, previous: 64 },
  { axis: 'Мобил.', current: 79, previous: 69 },
];

export function ChartsCatalog() {
  return (
    <Surface as="section" className="ui-kit-section">
      <Text variant="title">Charts · Recharts</Text>
      <Text variant="caption" tone="muted">Стандартные Line и Radar: готовые легенда, точки и подсказки Recharts.</Text>
      <Divider />
      <MezfitLineChart label="Динамика веса" data={progress} xKey="week"
        series={[{ dataKey: 'current', name: 'Сейчас' }, { dataKey: 'previous', name: 'Раньше' }]} />
      <Divider />
      <MezfitRadarChart label="Профиль показателей" data={profile} angleKey="axis" domain={[0, 100]}
        series={[{ dataKey: 'current', name: 'Сейчас' }, { dataKey: 'previous', name: 'Раньше' }]} />
    </Surface>
  );
}
