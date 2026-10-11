import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { PropsWithChildren } from 'react';

vi.mock('recharts', () => {
  const Container = ({ children }: PropsWithChildren) => <div data-chart-container>{children}</div>;
  const Plot = ({ children, data }: PropsWithChildren<{ data?: readonly Record<string, unknown>[] }>) => (
    <div
      data-chart-plot
      data-chart-length={data?.length}
      data-chart-nonfinite={data?.some((row) => Object.values(row).some((value) => typeof value === 'number' && !Number.isFinite(value)))}
      data-chart-nulls={data?.map((row) => Object.keys(row).filter((key) => row[key] === null).join(',')).join(';')}
    >
      {children}
    </div>
  );
  const Line = ({ dataKey, name, dot, stroke }: { dataKey: string; name: string; dot: boolean | { r: number }; stroke: string }) => (
    <span data-line-key={dataKey} data-series-name={name} data-dot={dot === false ? 'none' : 'visible'} data-stroke={stroke} />
  );
  const Radar = ({ dataKey, name, stroke }: { dataKey: string; name: string; stroke: string }) => (
    <span data-radar-key={dataKey} data-series-name={name} data-stroke={stroke} />
  );
  const Axis = () => null;
  const TickAxis = ({ tick, width, tickFormatter }: {
    tick?: { fill?: string };
    width?: number | string;
    tickFormatter?: (value: string) => string;
  }) => (
    <span data-axis-tick-fill={tick?.fill ?? ''} data-axis-width={width ?? ''} data-formatted-radar-label={tickFormatter?.('Выносливость') ?? ''} />
  );
  const RadiusAxis = ({ domain, allowDataOverflow }: { domain: (number | string)[]; allowDataOverflow?: boolean }) => (
    <span data-radius-domain={domain.join(',')} data-radius-overflow={String(allowDataOverflow)} />
  );
  return {
    ResponsiveContainer: Container,
    LineChart: Plot,
    RadarChart: Plot,
    Line,
    Radar,
    CartesianGrid: Axis,
    PolarAngleAxis: TickAxis,
    PolarGrid: Axis,
    PolarRadiusAxis: RadiusAxis,
    Tooltip: Axis,
    XAxis: TickAxis,
    YAxis: TickAxis,
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

  it('passes theme muted fill to both cartesian axes', () => {
    const html = renderToStaticMarkup(
      <MezfitLineChart
        label="Ось прогресса"
        data={[{ week: 'Н1', weight: 76 }]}
        xKey="week"
        series={[{ dataKey: 'weight', name: 'Вес' }]}
      />,
    );
    expect(html.match(/data-axis-tick-fill="var\(--ui-color-surface-muted\)"/g)).toHaveLength(2);
  });

  it('keeps a line series color when an earlier series is filtered out', () => {
    const html = renderToStaticMarkup(
      <MezfitLineChart
        label="Сравнение нагрузки"
        data={[{ week: 'Н1', first: null, second: 70, third: 81 }, { week: 'Н2', first: null, second: 72, third: 83 }]}
        xKey="week"
        series={[{ dataKey: 'first', name: 'Первая' }, { dataKey: 'second', name: 'Вторая' }, { dataKey: 'third', name: 'Третья' }]}
      />,
    );
    expect(html).not.toContain('data-line-key="first"');
    expect(html).toContain('data-line-key="second"');
    expect(html).toContain('data-line-key="third"');
    expect(html).toContain('data-stroke="#b2a0ff"');
    expect(html).toContain('data-stroke="#63d9b0"');
    expect(html).toContain('role="list"');
    expect(html).toContain('background-color:#b2a0ff');
    expect(html).toContain('background-color:#63d9b0');
  });

  it('keeps a radar series color and the same theme when earlier data is missing', () => {
    const html = renderToStaticMarkup(
      <MezfitRadarChart
        label="Сравнение профилей"
        data={[
          { axis: 'Сила', first: 45, second: 65 },
          { axis: 'Техника', first: null, second: 75 },
          { axis: 'Баланс', first: 60, second: 70 },
        ]}
        angleKey="axis"
        series={[{ dataKey: 'first', name: 'Первая' }, { dataKey: 'second', name: 'Вторая' }]}
      />,
    );
    expect(html).not.toContain('data-radar-key="first"');
    expect(html).toContain('data-radar-key="second"');
    expect(html).toContain('data-stroke="#b2a0ff"');
    expect(html).toContain('data-axis-tick-fill="var(--ui-color-surface-muted)"');
  });

  it('locks an explicit radar domain even if the data exceeds its maximum', () => {
    const html = renderToStaticMarkup(
      <MezfitRadarChart
        label="Общая шкала"
        data={[
          { axis: 'A', score: 80 },
          { axis: 'B', score: 120 },
          { axis: 'C', score: 90 },
        ]}
        angleKey="axis"
        domain={[0, 100]}
        series={[{ dataKey: 'score', name: 'Значение' }]}
      />,
    );
    expect(html).toContain('data-radius-domain="0,100"');
    expect(html).toContain('data-radius-overflow="true"');
  });

  it('leaves the automatic radar range expandable without a supplied domain', () => {
    const html = renderToStaticMarkup(
      <MezfitRadarChart
        label="Автоматический диапазон"
        data={[{ axis: 'A', value: 3 }, { axis: 'B', value: 5 }, { axis: 'C', value: 8 }]}
        angleKey="axis"
        series={[{ dataKey: 'value', name: 'Показатель' }]}
      />,
    );
    expect(html).toContain('data-radius-domain="0,auto"');
    expect(html).toContain('data-radius-overflow="false"');
  });

  it('drops rows with invalid X labels before computing visible line values', () => {
    const html = renderToStaticMarkup(
      <MezfitLineChart
        label="Точки без категории"
        data={[
          { week: undefined, weight: 71 },
          { week: '  ', weight: 72 },
          { week: 'Н2', weight: 73 },
          { week: 'Н3', weight: 74 },
        ]}
        xKey="week"
        series={[{ dataKey: 'weight', name: 'Вес' }]}
      />,
    );
    expect(html).toContain('data-chart-length="2"');
    expect(html).toContain('data-line-key="weight"');
  });

  it('sanitizes NaN and infinities before passing line values to chart and tooltip', () => {
    const html = renderToStaticMarkup(
      <MezfitLineChart
        label="Числовые пропуски"
        data={[
          { week: 'Н1', weight: 10 },
          { week: 'Н2', weight: Infinity },
          { week: 'Н3', weight: NaN },
          { week: 'Н4', weight: -Infinity },
          { week: 'Н5', weight: 20 },
        ]}
        xKey="week"
        series={[{ dataKey: 'weight', name: 'Вес' }]}
      />,
    );
    expect(html).toContain('data-chart-length="5"');
    expect(html).toContain('data-chart-nonfinite="false"');
    expect(html).toContain('data-chart-nulls=";weight;weight;weight;"');
    expect(html).toContain('data-dot="visible"');
  });

  it('rejects duplicate radar categories after trimming, including whitespace-only labels', () => {
    const duplicate = renderToStaticMarkup(
      <MezfitRadarChart
        label="Повторение оси"
        data={[{ axis: ' A ', score: 40 }, { axis: 'A', score: 60 }, { axis: 'B', score: 80 }]}
        angleKey="axis"
        series={[{ dataKey: 'score', name: 'Оценка' }]}
      />,
    );
    const blank = renderToStaticMarkup(
      <MezfitRadarChart
        label="Пустая ось"
        data={[{ axis: 'A', score: 40 }, { axis: '  ', score: 60 }, { axis: 'B', score: 80 }]}
        angleKey="axis"
        series={[{ dataKey: 'score', name: 'Оценка' }]}
      />,
    );
    expect(duplicate).toContain('Нет данных для графика');
    expect(blank).toContain('Нет данных для графика');
    expect(duplicate).not.toContain('data-radar-key');
    expect(blank).not.toContain('data-radar-key');
  });

  it('reserves Y-axis width automatically for large or negative labels', () => {
    const html = renderToStaticMarkup(
      <MezfitLineChart
        label="Крупные значения"
        data={[{ week: 'Н1', value: -1000000 }, { week: 'Н2', value: 2000000 }]}
        xKey="week"
        series={[{ dataKey: 'value', name: 'Значение' }]}
      />,
    );
    expect(html).toContain('data-axis-width="auto"');
  });

  it('shortens radar tick labels but exposes the complete category names', () => {
    const html = renderToStaticMarkup(
      <MezfitRadarChart
        label="Полные названия"
        data={[
          { axis: 'Выносливость', score: 80 },
          { axis: 'Техника', score: 70 },
          { axis: 'Мобильность', score: 90 },
        ]}
        angleKey="axis"
        series={[{ dataKey: 'score', name: 'Показатель' }]}
      />,
    );
    expect(html).toContain('data-formatted-radar-label="Выносли…"');
    expect(html).toContain('Полные названия осей: Выносливость · Мобильность');
    expect(html).toContain('data-radar-key="score"');
  });

  it('reports missing fifth-series color instead of reusing another series color', () => {
    const html = renderToStaticMarkup(
      <MezfitLineChart
        label="Много рядов"
        data={[{ step: 'A', a: 1, b: 2, c: 3, d: 4, e: 5 }]}
        xKey="step"
        series={[
          { dataKey: 'a', name: 'A' },
          { dataKey: 'b', name: 'B' },
          { dataKey: 'c', name: 'C' },
          { dataKey: 'd', name: 'D' },
          { dataKey: 'e', name: 'E' },
        ]}
      />,
    );
    expect(html).toContain('Для каждого ряда необходим уникальный цвет');
    expect(html).not.toContain('data-line-key');
  });

  it('accepts five series with a distinct fifth color and rejects duplicate explicit colors', () => {
    const rows = [{ axis: 'А', a: 1, b: 2, c: 3, d: 4, e: 5 }, { axis: 'Б', a: 2, b: 3, c: 4, d: 5, e: 6 }, { axis: 'В', a: 3, b: 4, c: 5, d: 6, e: 7 }];
    const regularSeries = [
      { dataKey: 'a' as const, name: 'A' },
      { dataKey: 'b' as const, name: 'B' },
      { dataKey: 'c' as const, name: 'C' },
      { dataKey: 'd' as const, name: 'D' },
      { dataKey: 'e' as const, name: 'E', color: '#abcdef' },
    ];
    const good = renderToStaticMarkup(
      <MezfitRadarChart label="Пять рядов" data={rows} angleKey="axis" series={regularSeries} />,
    );
    const duplicate = renderToStaticMarkup(
      <MezfitRadarChart label="Повтор цвета" data={rows} angleKey="axis"
        series={[...regularSeries.slice(0, 4), { dataKey: 'e', name: 'E', color: '#ffbf70' }]}
      />,
    );
    expect(good).toContain('data-radar-key="e"');
    expect(good).toContain('data-stroke="#abcdef"');
    expect(duplicate).toContain('Для каждого ряда необходим уникальный цвет');
    expect(duplicate).not.toContain('data-radar-key');
  });

  it('rejects duplicate series dataKey in line charts rather than rendering the same metric twice', () => {
    const html = renderToStaticMarkup(
      <MezfitLineChart
        label="Дублирующиеся линии"
        data={[{ week: 'Н1', weight: 72 }, { week: 'Н2', weight: 74 }]}
        xKey="week"
        series={[
          { dataKey: 'weight', name: 'Текущий вес', color: '#123456' },
          { dataKey: 'weight', name: 'Повторный вес', color: '#abcdef' },
        ]}
      />,
    );
    expect(html).toContain('Каждый ряд должен иметь уникальный dataKey');
    expect(html).not.toContain('data-line-key');
    expect(html).not.toContain('data-chart-container');
  });

  it('rejects duplicate radar dataKey before rendering polygons and legend', () => {
    const html = renderToStaticMarkup(
      <MezfitRadarChart
        label="Дублирующиеся показатели"
        data={[
          { axis: 'A', score: 70 },
          { axis: 'B', score: 80 },
          { axis: 'C', score: 90 },
        ]}
        angleKey="axis"
        series={[
          { dataKey: 'score', name: 'Показатель A' },
          { dataKey: 'score', name: 'Показатель B' },
        ]}
      />,
    );
    expect(html).toContain('Каждый ряд должен иметь уникальный dataKey');
    expect(html).not.toContain('data-radar-key');
    expect(html).not.toContain('Ряды графика');
  });

  it('preserves the selected plot height for empty and non-empty charts', () => {
    const empty = renderToStaticMarkup(
      <MezfitRadarChart<{ axis: string; score: number | null }>
        label="Пустой профиль" height={320} data={[]} angleKey="axis"
        series={[{ dataKey: 'score', name: 'Оценка' }]}
      />,
    );
    const populated = renderToStaticMarkup(
      <MezfitRadarChart label="Полный профиль" height={320}
        data={[{ axis: 'A', score: 3 }, { axis: 'B', score: 5 }, { axis: 'C', score: 7 }]}
        angleKey="axis" series={[{ dataKey: 'score', name: 'Оценка' }]}
      />,
    );
    expect(empty).toContain('style="height:320px"');
    expect(populated).toContain('style="height:320px"');
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
