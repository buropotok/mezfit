import type { SourceSetMetrics } from '../worker/processor/source-package/types';
import type { ConvertedMeasurement, ConvertedMetrics, ExerciseTracking, IssueCode } from './types';

const factors = {
  weight: { kg: 1, g: 0.001, lb: 0.45359237, lbs: 0.45359237 },
  duration: { s: 1, sec: 1, ms: 0.001, min: 60, h: 3600 },
  distance: { m: 1, km: 1000, cm: 0.01, mi: 1609.344, ft: 0.3048 },
} as const;
const unit = { weight: 'kg', duration: 's', distance: 'm' } as const;
const allowed: Record<ExerciseTracking, ReadonlySet<keyof SourceSetMetrics>> = {
  weight_reps: new Set<keyof SourceSetMetrics>(['weight', 'reps']),
  time: new Set<keyof SourceSetMetrics>(['duration']),
  time_distance: new Set<keyof SourceSetMetrics>(['duration', 'distance']),
  time_reps: new Set<keyof SourceSetMetrics>(['duration', 'reps']),
  time_weight: new Set<keyof SourceSetMetrics>(['duration', 'weight']),
};

function convert(kind: 'weight' | 'duration' | 'distance', input: { value: number; unit: string | null } | null):
  ConvertedMeasurement | null | 'error' {
  if (input === null) return null;
  const factor = input.unit === null
    ? undefined : (factors[kind] as Readonly<Record<string, number>>)[input.unit];
  if (factor === undefined) return 'error';
  const exact = input.value * factor;
  if (!Number.isFinite(exact) || exact < 0 || exact > Number.MAX_SAFE_INTEGER) return 'error';
  if (!Number.isSafeInteger(Math.round(exact * 1e6))) return 'error';
  const rounded = Math.round(exact * 1e6) / 1e6;
  if (!Number.isFinite(rounded) || rounded < 0 || (input.value > 0 && rounded === 0)) return 'error';
  return { value: rounded, unit: unit[kind], originalValue: input.value, originalUnit: input.unit!, precision: 6 };
}

export function convertMetrics(metrics: SourceSetMetrics, tracking: ExerciseTracking): {
  metrics: ConvertedMetrics | null; issues: IssueCode[];
} {
  const issues: IssueCode[] = [];
  const weight = convert('weight', metrics.weight);
  const duration = convert('duration', metrics.duration);
  const distance = convert('distance', metrics.distance);
  if (weight === 'error' || duration === 'error' || distance === 'error') issues.push('UNSUPPORTED_UNIT');
  for (const field of ['reps', 'weight', 'duration', 'distance'] as const) {
    if (metrics[field] !== null && !allowed[tracking].has(field)) issues.push('TRACKING_METRICS_CONFLICT');
  }
  return issues.length
    ? { metrics: null, issues: [...new Set(issues)] }
    : { metrics: { reps: metrics.reps, weight: weight as ConvertedMeasurement | null,
      duration: duration as ConvertedMeasurement | null, distance: distance as ConvertedMeasurement | null }, issues: [] };
}
