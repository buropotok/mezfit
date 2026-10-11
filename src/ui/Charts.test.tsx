import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { PropsWithChildren } from 'react';

vi.mock('recharts', () => {
  const Container = ({ children }: PropsWithChildren) => <div data-chart-container>{children}</div>;
  const Plot = ({ children }: PropsWithChildren) => <div data-chart-plot>{children}</div>;
  const Line = ({ dataKey, name }: { dataKey: string; name: string }) => <span data-line-key={dataKey} data-series-name={name} />;
  const Radar = ({ dataKey, name }: { dataKey: string; name: string }) => <span data-radar-key={dataKey} data-series-name={name} />;
  const Axis = () => null;
  return {
    ResponsiveContainer: Container,
    LineChart: Plot,
    RadarChart: Plot,
    Line,
    Radar,
    CartesianGrid: Axis,
    Legend: Axis,
    PolarAngleAxis: Axis,
    PolarGrid: Axis,
    PolarRadiusAxis: Axis,
    Tooltip: Axis,
    XAxis: Axis,
    YAxis: Axis,
  };
});

import { MezfitLineChart, MezfitRadarChart } from './Charts';

describe('UI Kit charts', () => {
  it('renders typed line-series mapping and accessible description', () => {
    const html = renderToStaticMarkup(
      <MezfitLineChart
        label="История веса"
        data={[{ week: 'Н1', weight: 75, reps: 8 }]}
        xKey="week"
        series={[{ dataKey: 'weight', name: 'Вес, кг' }, { dataKey: 'reps', name: 'Повторения' }]}
      />,
    );
    expect(html).toContain('aria-label="История веса"');
    expect(html).toContain('data-line-key="weight"');
    expect(html).toContain('data-line-key="reps"');
    expect(html).not.toContain('Нет данных');
  });

  it('renders radar series with three categorical axes', () => {
    const html = renderToStaticMarkup(
      <MezfitRadarChart
        label="Профиль"
        data={[{ name: 'A', value: 0 }, { name: 'B', value: 80 }, { name: 'C', value: 100 }]}
        angleKey="name"
        domain={[0, 100]}
        series={[{ dataKey: 'value', name: 'Оценка' }]}
      />,
    );
    expect(html).toContain('data-radar-key="value"');
  });

  it('shows the shared empty state when line data has no numeric values', () => {
    const html = renderToStaticMarkup(
      <MezfitLineChart label="Нет результатов" xKey="week" data={[{ week: 'Н1', weight: null }]} series={[{ dataKey: 'weight', name: 'Вес' }]} />,
    );
    expect(html).toContain('Нет данных для графика');
    expect(html).not.toContain('data-chart-container');
  });

  it('does not plot a radar with fewer than three axes', () => {
    const html = renderToStaticMarkup(
      <MezfitRadarChart label="Нет категорий" angleKey="dimension" data={[{ dimension: 'A', value: 3 }, { dimension: 'B', value: 5 }]} series={[{ dataKey: 'value', name: 'Значение' }]} />,
    );
    expect(html).toContain('Нет данных для графика');
  });
});
