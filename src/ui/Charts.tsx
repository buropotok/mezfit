import {
  CartesianGrid, Legend, Line, LineChart, PolarAngleAxis, PolarGrid, PolarRadiusAxis,
  Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

/** Thin UI Kit adapters: Recharts owns dots, legends, axes, tooltips and rendering. */
export type ChartSeries<TKey extends string> = { dataKey: TKey; name: string; color?: string };

export type ChartNumericKey<T extends object> = Extract<{
  [K in keyof T]-?: NonNullable<T[K]> extends number ? K : never;
}[keyof T], string>;

type ChartProps<T extends object> = {
  label: string;
  data: readonly T[];
  series: readonly ChartSeries<ChartNumericKey<NoInfer<T>>>[];
  height?: number;
};

export type MezfitLineChartProps<T extends object> = ChartProps<T> & {
  xKey: Extract<keyof NoInfer<T>, string>;
};

export type MezfitRadarChartProps<T extends object> = ChartProps<T> & {
  angleKey: Extract<keyof NoInfer<T>, string>;
  domain?: readonly [number, number];
};

const COLORS = ['var(--ui-color-primary)', '#b2a0ff', '#63d9b0', '#ffbf70'] as const;
const TICK = { fill: 'var(--ui-color-surface-muted)' };
const TOOLTIP = {
  backgroundColor: 'var(--ui-color-surface-raised)',
  borderColor: 'var(--ui-color-border)',
  color: 'var(--ui-color-surface-text)',
};

export function MezfitLineChart<T extends object>({
  label, data, series, xKey, height = 240,
}: MezfitLineChartProps<T>) {
  return (
    <div role="group" aria-label={label} className="ui-text ui-text--caption" style={{ width: '100%', minWidth: 0, height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={[...data]}>
          <CartesianGrid stroke="var(--ui-color-border)" vertical={false} />
          <XAxis dataKey={xKey} tick={TICK} />
          <YAxis width="auto" tick={TICK} />
          <Tooltip contentStyle={TOOLTIP} />
          <Legend />
          {series.map((item, index) => (
            <Line key={item.dataKey} dataKey={item.dataKey} name={item.name}
              stroke={item.color ?? COLORS[index % COLORS.length]} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MezfitRadarChart<T extends object>({
  label, data, series, angleKey, domain, height = 280,
}: MezfitRadarChartProps<T>) {
  return (
    <div role="group" aria-label={label} className="ui-text ui-text--caption" style={{ width: '100%', minWidth: 0, height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={[...data]} outerRadius="55%" margin={{ top: 12, right: 16, bottom: 12, left: 16 }}>
          <PolarGrid stroke="var(--ui-color-border)" />
          <PolarAngleAxis dataKey={angleKey} tick={TICK} />
          <PolarRadiusAxis domain={domain ? [...domain] : undefined} tick={false} />
          <Tooltip contentStyle={TOOLTIP} />
          <Legend />
          {series.map((item, index) => (
            <Radar key={item.dataKey} dataKey={item.dataKey} name={item.name}
              stroke={item.color ?? COLORS[index % COLORS.length]}
              fill={item.color ?? COLORS[index % COLORS.length]} fillOpacity={0.2} />
          ))}
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
