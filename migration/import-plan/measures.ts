import type { SourceMeasurement, SourceSetMetrics } from '../worker/processor/source-package/types';
import type { IssueCode, MappedMetrics, Tracking } from './contracts';

const weight = new Map([['kg', 1], ['g', 0.001], ['lb', 0.45359237], ['lbs', 0.45359237]]);
const duration = new Map([['s', 1], ['sec', 1], ['ms', 0.001], ['min', 60], ['h', 3600]]);
const distance = new Map([['m', 1], ['km', 1000], ['cm', 0.01], ['mi', 1609.344], ['ft', 0.3048]]);
const dimensions: Record<Tracking, ReadonlySet<keyof SourceSetMetrics>> = {
  weight_reps: new Set(['weight', 'reps']),
  time: new Set(['duration']),
  time_distance: new Set(['duration', 'distance']),
  time_reps: new Set(['duration', 'reps']),
  time_weight: new Set(['duration', 'weight']),
};

function convert(measure: SourceMeasurement | null, factors: ReadonlyMap<string, number>): number | null {
  if (measure === null) return null;
  const factor = measure.unit === null ? undefined : factors.get(measure.unit);
  const value = factor === undefined ? NaN : measure.value * factor;
  // IEEE-754 result of the stated unit factor. Preserve precision and report
  // overflow rather than clamping. A nonzero source cannot silently underflow.
  return Number.isFinite(value) && (value !== 0 || measure.value === 0) ? value : null;
}

export function mapMetrics(original: SourceSetMetrics, type: Tracking | null, report: (code: IssueCode) => void): MappedMetrics {
  const result = { reps: original.reps, weightKg: convert(original.weight, weight),
    durationSeconds: convert(original.duration, duration), distanceMeters: convert(original.distance, distance) };
  if ((original.weight !== null && result.weightKg === null)
    || (original.duration !== null && result.durationSeconds === null)
    || (original.distance !== null && result.distanceMeters === null)) {
    report('UNSUPPORTED_UNIT');
    return { original, converted: null };
  }
  if (type === null) return { original, converted: null };
  const fields = ['reps', 'weight', 'duration', 'distance'] as const;
  if (fields.some(name => original[name] !== null && !dimensions[type].has(name))) {
    report('INCOMPATIBLE_METRICS');
    return { original, converted: null };
  }
  return { original, converted: result };
}
