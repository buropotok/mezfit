import type { CSSProperties, ReactNode } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart as RechartsLineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart as RechartsRadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Text } from './primitives';
import './charts.css';

/** Only fields containing numbers (optionally null/undefined) may be plotted. */
export type ChartNumericKey<T extends object> = Extract<{
  [K in keyof T]-?: NonNullable<T[K]> extends number ? K : never;
}[keyof T], string>;

/** Category labels may be string or numeric fields, optionally missing. */
export type ChartCategoryKey<T extends object> = Extract<{
  [K in keyof T]-?: NonNullable<T[K]> extends string | number ? K : never;
}[keyof T], string>;

export interface ChartSeries<TKey extends string = string> {
  dataKey: TKey;
  name: string;
  color?: string;
}

interface ChartBaseProps<T extends object> {
  /** Human-readable description for assistive technology. */
  label: string;
  data: readonly T[];
  series: readonly ChartSeries<ChartNumericKey<NoInfer<T>>>[];
  /** Height of the plot in CSS pixels; width always follows its container. */
  height?: number;
  className?: string;
}

export interface MezfitLineChartProps<T extends object> extends ChartBaseProps<T> {
  xKey: ChartCategoryKey<NoInfer<T>>;
}

export interface MezfitRadarChartProps<T extends object> extends ChartBaseProps<T> {
  angleKey: ChartCategoryKey<NoInfer<T>>;
  /** Set a common numeric scale for every series (e.g. [0, 100]). */
  domain?: readonly [number, number];
}

const SERIES_COLORS = [
  'var(--ui-color-primary)',
  '#b2a0ff',
  '#63d9b0',
  '#ffbf70',
] as const;
const RADAR_TICK_MAX_CHARS = 8;
const INVALID_PALETTE_MESSAGE = 'Для каждого ряда необходим уникальный цвет (после четвёртого задайте color)';

const AXIS_TICK = {
  className: 'ui-text ui-text--caption ui-text--muted',
  fill: 'var(--ui-color-surface-muted)',
};
const TOOLTIP_STYLE: CSSProperties = {
  backgroundColor: 'var(--ui-color-surface-raised)',
  border: '1px solid var(--ui-color-border)',
  borderRadius: 'var(--ui-radius-control)',
  color: 'var(--ui-color-surface-text)',
};

function chartColor(series: ChartSeries): string {
  return series.color ?? '';
}

/** Four automatic colors; additional series must provide their own distinct colors. */
function resolveSeriesColors<TKey extends string>(series: readonly ChartSeries<TKey>[]) {
  const colored = series.map((item, index) => ({ ...item, color: item.color ?? SERIES_COLORS[index] }));
  const valid = colored.every((item) => typeof item.color === 'string' && item.color.trim().length > 0)
    && new Set(colored.map((item) => item.color)).size === colored.length;
  return { colored, valid };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidCategory(value: unknown): value is string | number {
  return isFiniteNumber(value) || (typeof value === 'string' && value.trim().length > 0);
}

function prepareLineData<T extends object>(
  data: readonly T[],
  xKey: ChartCategoryKey<T>,
  series: readonly ChartSeries<ChartNumericKey<T>>[],
): Record<string, unknown>[] {
  return data.filter((point) => isValidCategory(point[xKey])).map((point) => {
    const prepared: Record<string, unknown> = Object.fromEntries(Object.entries(point));
    for (const item of series) {
      if (!isFiniteNumber(prepared[item.dataKey])) prepared[item.dataKey] = null;
    }
    return prepared;
  });
}

function finitePointCount(data: readonly Record<string, unknown>[], dataKey: string): number {
  return data.reduce((count, point) => count + (isFiniteNumber(point[dataKey]) ? 1 : 0), 0);
}

/** An isolated point cannot form a line segment while connectNulls=false. */
function hasIsolatedPoint(data: readonly Record<string, unknown>[], dataKey: string): boolean {
  return data.some((point, index) =>
    isFiniteNumber(point[dataKey])
    && (index === 0 || !isFiniteNumber(data[index - 1][dataKey]))
    && (index === data.length - 1 || !isFiniteNumber(data[index + 1][dataKey]))
  );
}

function radarTickLabel(value: string | number): string {
  const chars = Array.from(String(value));
  return chars.length > RADAR_TICK_MAX_CHARS
    ? `${chars.slice(0, RADAR_TICK_MAX_CHARS - 1).join('')}…`
    : chars.join('');
}

function ChartFrame({ label, height, className, empty, emptyMessage, fullAxisLabels, series, children }: {
  label: string;
  height: number;
  className?: string;
  empty: boolean;
  emptyMessage?: string;
  fullAxisLabels?: readonly string[];
  series: readonly ChartSeries[];
  children: ReactNode;
}) {
  return (
    <div className={`mezfit-chart ui-text ui-text--caption${className ? ` ${className}` : ''}`} role="group" aria-label={label}>
      {empty
        ? <div className="mezfit-chart__empty" style={{ height }}><Text variant="footnote" tone="muted">{emptyMessage ?? 'Нет данных для графика'}</Text></div>
        : (
          <>
            <div className="mezfit-chart__plot" style={{ height }}>{children}</div>
            {fullAxisLabels && fullAxisLabels.length > 0 && (
              <div className="mezfit-chart__axis-labels">
                <Text variant="caption" tone="muted">Полные названия осей: {fullAxisLabels.join(' · ')}</Text>
              </div>
            )}
            {series.length > 1 && (
              <div className="mezfit-chart__legend" role="list" aria-label="Ряды графика">
                {series.map((item) => (
                  <span className="mezfit-chart__legend-item" role="listitem" key={item.dataKey}>
                    <span className="mezfit-chart__swatch" style={{ backgroundColor: chartColor(item) }} aria-hidden="true" />
                    <Text variant="caption" tone="muted">{item.name}</Text>
                  </span>
                ))}
              </div>
            )}
          </>
        )}
    </div>
  );
}

/** Time/category series. Accepts already aggregated, domain-independent data. */
export function MezfitLineChart<T extends object>({ label, data, series, xKey, height = 240, className }: MezfitLineChartProps<T>) {
  const preparedData = prepareLineData(data, xKey, series);
  const palette = resolveSeriesColors(series);
  const visible = palette.valid
    ? palette.colored
      .map((item) => ({ item, count: finitePointCount(preparedData, item.dataKey) }))
      .filter(({ count }) => count > 0)
    : [];
  return (
    <ChartFrame label={label} height={height} className={className} empty={visible.length === 0}
      emptyMessage={palette.valid ? undefined : INVALID_PALETTE_MESSAGE} series={visible.map(({ item }) => item)}>
      <ResponsiveContainer width="100%" height="100%" minWidth={1}>
        <RechartsLineChart data={preparedData} margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="var(--ui-color-border)" vertical={false} strokeDasharray="3 5" />
          <XAxis dataKey={xKey} tick={AXIS_TICK} tickLine={false} axisLine={false} tickMargin={10} minTickGap={16} />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width="auto" domain={['auto', 'auto']} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: 'var(--ui-color-border)' }} />
          {visible.map(({ item, count }) => (
            <Line
              key={item.dataKey}
              dataKey={item.dataKey}
              name={item.name}
              type="monotone"
              stroke={chartColor(item)}
              strokeWidth={2.5}
              dot={count <= 2 || hasIsolatedPoint(preparedData, item.dataKey) ? { r: 3 } : false}
              activeDot={{ r: 4 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </RechartsLineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** Category comparison. Caller owns metric normalization and units. */
export function MezfitRadarChart<T extends object>({ label, data, series, angleKey, domain, height = 280, className }: MezfitRadarChartProps<T>) {
  // Duplicated/blank labels collapse radar angles; missing numbers become misleading zeros.
  const uniqueAxes = new Set<string>();
  const validAxes = data.length >= 3 && data.every((point) => {
    const category = point[angleKey];
    if (!isValidCategory(category)) return false;
    const name = String(category).trim();
    if (uniqueAxes.has(name)) return false;
    uniqueAxes.add(name);
    return true;
  });
  const preparedData = validAxes
    ? data.map((point) => ({
      ...point,
      [angleKey]: typeof point[angleKey] === 'string' ? point[angleKey].trim() : point[angleKey],
    }))
    : [];
  const palette = resolveSeriesColors(series);
  const visible = validAxes && palette.valid
    ? palette.colored.filter((item) => preparedData.every((point) => isFiniteNumber(point[item.dataKey])))
    : [];
  const fullAxisLabels = preparedData
    .map((point) => String(point[angleKey]))
    .filter((name) => Array.from(name).length > RADAR_TICK_MAX_CHARS);
  return (
    <ChartFrame label={label} height={height} className={className} empty={visible.length === 0}
      emptyMessage={palette.valid ? undefined : INVALID_PALETTE_MESSAGE}
      fullAxisLabels={fullAxisLabels} series={visible}>
      <ResponsiveContainer width="100%" height="100%" minWidth={1}>
        <RechartsRadarChart data={preparedData} outerRadius="68%" margin={{ top: 18, right: 24, bottom: 18, left: 24 }}>
          <PolarGrid stroke="var(--ui-color-border)" />
          <PolarAngleAxis dataKey={angleKey} tick={AXIS_TICK} tickFormatter={radarTickLabel} />
          <PolarRadiusAxis tick={false} axisLine={false} domain={domain ? [...domain] : [0, 'auto']} allowDataOverflow={domain !== undefined} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          {visible.map((item) => (
            <Radar
              key={item.dataKey}
              name={item.name}
              dataKey={item.dataKey}
              stroke={chartColor(item)}
              strokeWidth={2}
              fill={chartColor(item)}
              fillOpacity={0.16}
              isAnimationActive={false}
            />
          ))}
        </RechartsRadarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
