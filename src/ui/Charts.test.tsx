import { renderToStaticMarkup } from 'react-dom/server';
import type { PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('recharts', () => {
  const Frame = ({ children }: PropsWithChildren) => <div>{children}</div>;
  const Plot = ({ children, data }: PropsWithChildren<{ data: unknown[] }>) => (
    <div data-count={data.length}>{children}</div>
  );
  const Axis = () => null;
  const Legend = () => <span data-native-legend />;
  const Line = ({ dataKey, name, dot }: { dataKey: string; name: string; dot?: boolean }) => (
    <span data-line={dataKey} data-name={name} data-dot={dot === undefined ? 'native' : 'overridden'} />
  );
  const Radar = ({ dataKey, name }: { dataKey: string; name: string }) => (
    <span data-radar={dataKey} data-name={name} />
  );
  return {
    ResponsiveContainer: Frame,
    LineChart: Plot,
    RadarChart: Plot,
    CartesianGrid: Axis,
    XAxis: Axis,
    YAxis: Axis,
    PolarGrid: Axis,
    PolarAngleAxis: Axis,
    PolarRadiusAxis: Axis,
    Tooltip: Axis,
    Legend,
    Line,
    Radar,
  };
});

import { MezfitLineChart, MezfitRadarChart } from './Charts';

describe('UI Kit Recharts adapters', () => {
  it('passes line data and series to the native chart with native dots and legend', () => {
    const html = renderToStaticMarkup(
      <MezfitLineChart label="Вес" data={[{ week: 'Н1', weight: 70 }, { week: 'Н2', weight: 72 }]}
        xKey="week" series={[{ dataKey: 'weight', name: 'Килограммы' }]} />,
    );
    expect(html).toContain('aria-label="Вес"');
    expect(html).toContain('ui-text--caption');
    expect(html).toContain('data-count="2"');
    expect(html).toContain('data-line="weight"');
    expect(html).toContain('data-dot="native"');
    expect(html).toContain('data-native-legend');
  });

  it('passes radar values to the native chart and uses its legend', () => {
    const html = renderToStaticMarkup(
      <MezfitRadarChart label="Профиль" data={[{ axis: 'A', value: 3 }, { axis: 'B', value: 5 }, { axis: 'C', value: 7 }]}
        angleKey="axis" series={[{ dataKey: 'value', name: 'Результат' }]} />,
    );
    expect(html).toContain('aria-label="Профиль"');
    expect(html).toContain('data-count="3"');
    expect(html).toContain('data-radar="value"');
    expect(html).toContain('data-native-legend');
  });
});
