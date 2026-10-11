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

export type ChartDataPoint = Readonly<Record<string, string | number | null>>;

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

const AXIS_TICK = { className: 'ui-text ui-text--caption ui-text--muted' };
const TOOLTIP_STYLE: CSSProperties = {
  backgroundColor: 'var(--ui-color-surface-raised)',
  border: '1px solid var(--ui-color-border)',
  borderRadius: 'var(--ui-radius-control)',
  color: 'var(--ui-color-surface-text)',
};

function chartColor(series: ChartSeries, index: number): string {
  return series.color ?? SERIES_COLORS[index % SERIES_COLORS.length];
}

function finitePointCount<T extends object>(data: readonly T[], dataKey: ChartNumericKey<T>): number {
  return data.reduce((count, point) => {
    const value = point[dataKey];
    return count + (typeof value === 'number' && Number.isFinite(value) ? 1 : 0);
  }, 0);
}

function ChartFrame({ label, height, className, empty, series, children }: {
  label: string;
  height: number;
  className?: string;
  empty: boolean;
  series: readonly ChartSeries[];
  children: ReactNode;
}) {
  return (
    <div className={`mezfit-chart ui-text ui-text--caption${className ? ` ${className}` : ''}`} role="group" aria-label={label}>
      {empty
        ? <div className="mezfit-chart__empty"><Text variant="footnote" tone="muted">Нет данных для графика</Text></div>
        : (
          <>
            <div className="mezfit-chart__plot" style={{ height }}>{children}</div>
            {series.length > 1 && (
              <div className="mezfit-chart__legend" role="list" aria-label="Ряды графика">
                {series.map((item, index) => (
                  <span className="mezfit-chart__legend-item" role="listitem" key={item.dataKey}>
                    <span className="mezfit-chart__swatch" style={{ backgroundColor: chartColor(item, index) }} aria-hidden="true" />
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
  const visible = series
    .map((item) => ({ item, count: finitePointCount(data, item.dataKey) }))
    .filter(({ count }) => count > 0);
  return (
    <ChartFrame label={label} height={height} className={className} empty={visible.length === 0} series={visible.map(({ item }) => item)}>
      <ResponsiveContainer width="100%" height="100%" minWidth={1}>
        <RechartsLineChart data={[...data]} margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="var(--ui-color-border)" vertical={false} strokeDasharray="3 5" />
          <XAxis dataKey={xKey} tick={AXIS_TICK} tickLine={false} axisLine={false} tickMargin={10} minTickGap={16} />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} domain={['auto', 'auto']} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: 'var(--ui-color-border)' }} />
          {visible.map(({ item, count }, index) => (
            <Line
              key={item.dataKey}
              dataKey={item.dataKey}
              name={item.name}
              type="monotone"
              stroke={chartColor(item, index)}
              strokeWidth={2.5}
              dot={count <= 2 ? { r: 3 } : false}
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
  const visible = series.filter((item) => finitePointCount(data, item.dataKey) >= 3);
  return (
    <ChartFrame label={label} height={height} className={className} empty={visible.length === 0} series={visible}>
      <ResponsiveContainer width="100%" height="100%" minWidth={1}>
        <RechartsRadarChart data={[...data]} outerRadius="68%" margin={{ top: 18, right: 24, bottom: 18, left: 24 }}>
          <PolarGrid stroke="var(--ui-color-border)" />
          <PolarAngleAxis dataKey={angleKey} tick={AXIS_TICK} />
          <PolarRadiusAxis tick={false} axisLine={false} domain={domain ? [...domain] : [0, 'auto']} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          {visible.map((item, index) => (
            <Radar
              key={item.dataKey}
              name={item.name}
              dataKey={item.dataKey}
              stroke={chartColor(item, index)}
              strokeWidth={2}
              fill={chartColor(item, index)}
              fillOpacity={0.16}
              isAnimationActive={false}
            />
          ))}
        </RechartsRadarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
