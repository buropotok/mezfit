import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { PropsWithChildren } from 'react';

vi.mock('recharts', () => {
  const Container = ({ children }: PropsWithChildren) => <div data-chart-container>{children}</div>;
  const Plot = ({ children }: PropsWithChildren) => <div data-chart-plot>{children}</div>;
  const Line = ({ dataKey, name, dot }: { dataKey: string; name: string; dot: boolean | { r: number } }) => (
    <span data-line-key={dataKey} data-series-name={name} data-dot={dot === false ? 'none' : 'visible'} />
  );
  const Radar = ({ dataKey, name }: { dataKey: string; name: string }) => <span data-radar-key={dataKey} data-series-name={name} />;
  const Axis = () => null;
  return {
    ResponsiveContainer: Container,
    LineChart: Plot,
    RadarChart: Plot,
    Line,
    Radar,
    CartesianGrid: Axis,
    PolarAngleAxis: Axis,
    PolarGrid: Axis,
    PolarRadiusAxis: Axis,
    Tooltip: Axis,
    XAxis: Axis,
    YAxis: Axis,
  };
});

import { MezfitLineChart, MezfitRadarChart, type MezfitLineChartProps, type MezfitRadarChartProps } from './Charts';

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
    expect(html).toContain('data-dot="visible"');
    expect(html).toContain('role="list"');
    expect(html).toContain('ui-text--caption');
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
      <MezfitLineChart<{ week: string; weight: number | null }> label="Нет результатов" xKey="week" data={[{ week: 'Н1', weight: null }]} series={[{ dataKey: 'weight', name: 'Вес' }]} />,
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
  it('shows isolated finite line values instead of an invisible zero-length path', () => {
    const html = renderToStaticMarkup(
      <MezfitLineChart
        label="Один результат"
        data={[{ week: 'Н1', weight: null }, { week: 'Н2', weight: 72 }, { week: 'Н3', weight: null }]}
        xKey="week"
        series={[{ dataKey: 'weight', name: 'Вес' }]}
      />,
    );
    expect(html).toContain('data-line-key="weight"');
    expect(html).toContain('data-dot="visible"');
    expect(html).not.toContain('Нет данных');
  });

  it('keeps regular line traces without persistent dots once three finite values exist', () => {
    const html = renderToStaticMarkup(
      <MezfitLineChart
        label="История"
        data={[{ week: 'Н1', weight: 71 }, { week: 'Н2', weight: 72 }, { week: 'Н3', weight: 75 }]}
        xKey="week"
        series={[{ dataKey: 'weight', name: 'Вес' }]}
      />,
    );
    expect(html).toContain('data-dot="none"');
  });

  it('does not draw a radar polygon when only two values are finite', () => {
    const html = renderToStaticMarkup(
      <MezfitRadarChart
        label="Недостаточно значений"
        data={[{ axis: 'A', value: 70 }, { axis: 'B', value: null }, { axis: 'C', value: 80 }]}
        angleKey="axis"
        series={[{ dataKey: 'value', name: 'Показатель' }]}
      />,
    );
    expect(html).toContain('Нет данных для графика');
    expect(html).not.toContain('data-radar-key');
  });

  it('excludes incomplete radar series without hiding a valid series', () => {
    const html = renderToStaticMarkup(
      <MezfitRadarChart
        label="Несколько показателей"
        data={[
          { axis: 'A', full: 60, sparse: null },
          { axis: 'B', full: 70, sparse: 52 },
          { axis: 'C', full: 80, sparse: null },
        ]}
        angleKey="axis"
        series={[{ dataKey: 'full', name: 'Полный' }, { dataKey: 'sparse', name: 'Неполный' }]}
      />,
    );
    expect(html).toContain('data-radar-key="full"');
    expect(html).not.toContain('data-radar-key="sparse"');
    expect(html).not.toContain('Ряды графика');
  });

  it('keeps points visible when more than two finite values are isolated by gaps', () => {
    const html = renderToStaticMarkup(
      <MezfitLineChart
        label="Прерывистый прогресс"
        data={[
          { week: 'Н1', weight: 71 },
          { week: 'Н2', weight: null },
          { week: 'Н3', weight: 73 },
          { week: 'Н4', weight: null },
          { week: 'Н5', weight: 76 },
        ]}
        xKey="week"
        series={[{ dataKey: 'weight', name: 'Вес' }]}
      />,
    );
    expect(html).toContain('data-line-key="weight"');
    expect(html).toContain('data-dot="visible"');
    expect(html).not.toContain('Нет данных');
  });

  it('rejects a radar with a missing axis value instead of treating it as zero', () => {
    const html = renderToStaticMarkup(
      <MezfitRadarChart
        label="Неполный профиль"
        data={[
          { axis: 'Сила', score: 80 },
          { axis: 'Техника', score: 70 },
          { axis: 'Баланс', score: 90 },
          { axis: 'Гибкость', score: null },
        ]}
        angleKey="axis"
        series={[{ dataKey: 'score', name: 'Результат' }]}
      />,
    );
    expect(html).toContain('Нет данных для графика');
    expect(html).not.toContain('data-radar-key="score"');
  });

  it('filters incomplete radar series while preserving a fully measured profile', () => {
    const html = renderToStaticMarkup(
      <MezfitRadarChart
        label="Сравнение профилей"
        data={[
          { axis: 'Сила', current: 80, previous: 70 },
          { axis: 'Техника', current: 0, previous: 60 },
          { axis: 'Баланс', current: 90, previous: 75 },
          { axis: 'Гибкость', current: 65, previous: null },
        ]}
        angleKey="axis"
        series={[{ dataKey: 'current', name: 'Сейчас' }, { dataKey: 'previous', name: 'Раньше' }]}
      />,
    );
    expect(html).toContain('data-radar-key="current"');
    expect(html).not.toContain('data-radar-key="previous"');
    expect(html).not.toContain('Ряды графика');
    expect(html).not.toContain('Нет данных');
  });

  it('constrains category and numeric metric keys using the data row type', () => {
    type WorkoutRow = { week: string; weight: number | null; reps?: number; note: string };
    const line: MezfitLineChartProps<WorkoutRow> = {
      label: 'Тренировки',
      data: [{ week: 'Н1', weight: 70, note: 'Тест' }],
      xKey: 'week',
      series: [{ dataKey: 'weight', name: 'Вес' }, { dataKey: 'reps', name: 'Повторения' }],
    };
    const radar: MezfitRadarChartProps<WorkoutRow> = {
      ...line,
      angleKey: 'week',
    };
    expect(line.xKey).toBe('week');
    expect(radar.angleKey).toBe('week');

    // @ts-expect-error — unknown category must be rejected
    const missingAxis: MezfitLineChartProps<WorkoutRow>['xKey'] = 'missing';
    // @ts-expect-error — text fields are not numeric series
    const textSeries: MezfitLineChartProps<WorkoutRow>['series'] = [{ dataKey: 'note', name: 'Неверная метрика' }];
    // @ts-expect-error — radar categories must exist on the row
    const invalidRadarAxis: MezfitRadarChartProps<WorkoutRow>['angleKey'] = 'unknown';
    expect([missingAxis, textSeries, invalidRadarAxis]).toHaveLength(3);
  });

});
