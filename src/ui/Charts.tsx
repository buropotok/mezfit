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

export interface ChartSeries {
  dataKey: string;
  name: string;
  color?: string;
}

interface ChartBaseProps {
  /** Human-readable description for assistive technology. */
  label: string;
  data: readonly ChartDataPoint[];
  series: readonly ChartSeries[];
  /** Height of the plot in CSS pixels; width always follows its container. */
  height?: number;
  className?: string;
}

export interface MezfitLineChartProps extends ChartBaseProps {
  xKey: string;
}

export interface MezfitRadarChartProps extends ChartBaseProps {
  angleKey: string;
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

function hasValues(data: readonly ChartDataPoint[], series: readonly ChartSeries[]): boolean {
  return data.some((point) => series.some(({ dataKey }) => {
    const value = point[dataKey];
    return typeof value === 'number' && Number.isFinite(value);
  }));
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
export function MezfitLineChart({ label, data, series, xKey, height = 240, className }: MezfitLineChartProps) {
  const empty = data.length === 0 || series.length === 0 || !hasValues(data, series);
  return (
    <ChartFrame label={label} height={height} className={className} empty={empty} series={series}>
      <ResponsiveContainer width="100%" height="100%" minWidth={1}>
        <RechartsLineChart data={[...data]} margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="var(--ui-color-border)" vertical={false} strokeDasharray="3 5" />
          <XAxis dataKey={xKey} tick={AXIS_TICK} tickLine={false} axisLine={false} tickMargin={10} minTickGap={16} />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} domain={['auto', 'auto']} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: 'var(--ui-color-border)' }} />
          {series.map((item, index) => (
            <Line
              key={item.dataKey}
              dataKey={item.dataKey}
              name={item.name}
              type="monotone"
              stroke={chartColor(item, index)}
              strokeWidth={2.5}
              dot={false}
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
export function MezfitRadarChart({ label, data, series, angleKey, domain, height = 280, className }: MezfitRadarChartProps) {
  const empty = data.length < 3 || series.length === 0 || !hasValues(data, series);
  return (
    <ChartFrame label={label} height={height} className={className} empty={empty} series={series}>
      <ResponsiveContainer width="100%" height="100%" minWidth={1}>
        <RechartsRadarChart data={[...data]} outerRadius="68%" margin={{ top: 18, right: 24, bottom: 18, left: 24 }}>
          <PolarGrid stroke="var(--ui-color-border)" />
          <PolarAngleAxis dataKey={angleKey} tick={AXIS_TICK} />
          <PolarRadiusAxis tick={false} axisLine={false} domain={domain ? [...domain] : [0, 'auto']} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          {series.map((item, index) => (
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
