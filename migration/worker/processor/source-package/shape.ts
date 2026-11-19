import { record, exactKeys } from '../contracts';
import type { SourceImportPackageV1 } from './types';

// Fixed-depth schema, bounded collections and a global graph cap in validate.ts.
type Rule = (value: unknown) => boolean;
const object = (fields: Record<string, Rule>): Rule => value => record(value)
  && exactKeys(value, Object.keys(fields)) && Object.entries(fields).every(([key, rule]) => rule(value[key]));
const text: Rule = value => typeof value === 'string' && value.length <= 1000;
const key: Rule = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const nullable = (rule: Rule): Rule => value => value === null || rule(value);
const list = (rule: Rule, max = 32): Rule => value => Array.isArray(value) && value.length <= max && value.every(rule);
const choice = (...values: readonly unknown[]): Rule => value => values.includes(value);
const finite: Rule = value => typeof value === 'number' && Number.isFinite(value);
const positive: Rule = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const position: Rule = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const digest: Rule = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const ref: Rule = value => object({ state: choice('none', 'unknown') })(value)
  || object({ state: choice('linked'), sourceKey: key })(value);
const attribute: Rule = value => object({ name: key, kind: choice('string'), value: text })(value)
  || object({ name: key, kind: choice('number'), value: finite, unit: nullable(key) })(value)
  || object({ name: key, kind: choice('boolean'), value: choice(true, false) })(value)
  || object({ name: key, kind: choice('null'), value: choice(null) })(value);
const attrs = list(attribute, 16);
const measured = nullable(object({ value: positive, unit: nullable(key) }));
const metrics = object({ reps: nullable(position), weight: measured, duration: measured, distance: measured });

function date(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function instant(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) return false;
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value.replace(/(?:\.(\d{1,3}))?Z$/, (_match, fraction) =>
    '.' + String(fraction ?? '').padEnd(3, '0') + 'Z');
}
function zone(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 128 || !/^(UTC|[A-Za-z_]+(?:\/[A-Za-z_+0-9-]+)+)$/.test(value)) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; }
  catch { return false; }
}
const timing: Rule = value => object({
  localDate: nullable(date), startedAtUtc: nullable(instant), completedAtUtc: nullable(instant),
  timeZone: nullable(zone), precision: choice('instant', 'minute', 'date', 'unknown'),
})(value) && record(value)
  && (value.precision !== 'date' || value.localDate !== null && value.startedAtUtc === null && value.completedAtUtc === null)
  && (!['instant', 'minute'].includes(String(value.precision)) || value.startedAtUtc !== null || value.completedAtUtc !== null)
  && (value.startedAtUtc === null || value.completedAtUtc === null
    || Date.parse(String(value.startedAtUtc)) <= Date.parse(String(value.completedAtUtc)));

const programSet = object({ sourceKey: key, position, sourceSetType: nullable(text), sourceSetLabel: nullable(text),
  comment: nullable(text), sourceAttributes: attrs });
const programExercise = object({ sourceKey: key, exerciseSourceKey: key, position, notes: nullable(text),
  sets: list(programSet), sourceAttributes: attrs });
const planSet = object({ sourceKey: key, sourceProgramSetRef: ref, position, sourceSetType: nullable(text), metrics });
const planExercise = object({ sourceKey: key, exerciseSourceKey: key, sourceProgramExerciseRef: ref, position, sets: list(planSet) });
const plan: Rule = value => object({ state: choice('absent', 'unknown') })(value)
  || object({ state: choice('present'), exercises: list(planExercise) })(value);
const factSet = object({ sourceKey: key, position, planSetRef: ref, sourceSetType: nullable(text),
  sourceSetLabel: nullable(text), metrics, setStatus: choice('pending', 'completed', 'skipped', 'unknown'),
  rpe: nullable(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10),
  comment: nullable(text), sourceAttributes: attrs });
export const ISSUE_CODES = ['MISSING_SOURCE_ID', 'DUPLICATE_SOURCE_KEY', 'UNRESOLVED_SOURCE_REFERENCE',
  'UNSUPPORTED_SOURCE_FIELD', 'SOURCE_PROGRAM_NUMERIC_PRESCRIPTION', 'UNKNOWN_UNIT', 'DATE_PRECISION_INSUFFICIENT',
  'UNKNOWN_PROGRAM_RELATION', 'OMITTED_MEASURES'] as const;
const issue = object({ code: choice(...ISSUE_CODES), severity: choice('info', 'warning', 'error'),
  entityType: nullable(key), sourceKey: nullable(key), field: nullable(key) });
const coverageState = choice('complete', 'partial', 'not_in_export', 'unknown');
const root = object({
  kind: choice('mezfit.source-import'), schemaVersion: choice(1),
  provenance: object({ sourceApp: key, formatFamily: key, formatVersion: nullable(key), adapterId: key,
    adapterVersion: key, inputSha256: digest, exportKind: choice('full_backup', 'training_history', 'program_only', 'mixed', 'unknown') }),
  coverage: object({ subjects: coverageState, sourceExercises: coverageState, programs: coverageState,
    scheduledWorkouts: coverageState, sessions: coverageState, measures: coverageState }),
  subjects: list(object({ sourceKey: key, displayName: nullable(text), sourceContainerKeys: list(key), sourceAttributes: attrs })),
  sourceExercises: list(object({ sourceKey: key, sourceName: nullable(text), aliases: list(text),
    equipment: nullable(text), movementType: nullable(text), bodyPart: nullable(text), primaryMuscles: list(text),
    trackingHint: choice('weight_reps', 'time', 'time_distance', 'time_reps', 'time_weight', null), sourceAttributes: attrs })),
  programs: list(object({ sourceKey: key, subjectRef: ref, name: nullable(text),
    phases: list(object({ sourceKey: key, name: nullable(text), position, sourceAttributes: attrs })),
    days: list(object({ sourceKey: key, phaseRef: ref, name: nullable(text), position,
      exercises: list(programExercise), sourceAttributes: attrs })), sourceAttributes: attrs })),
  scheduledWorkouts: list(object({ sourceKey: key, subjectRef: ref, programRef: ref, programDayRef: ref,
    name: nullable(text), timing, plan, sourceAttributes: attrs })),
  sessions: list(object({ sourceKey: key, subjectRef: ref, scheduledWorkoutRef: ref, programRef: ref,
    name: nullable(text), timing, completionState: choice('completed', 'in_progress', 'unknown'), frozenPlan: plan,
    performedExercises: list(object({ sourceKey: key, exerciseSourceKey: key, position, notes: nullable(text),
      sets: list(factSet) })), sourceAttributes: attrs })),
  issues: list(issue, 256),
  omittedData: list(object({ category: key, reason: choice('unsupported_target', 'unreadable', 'not_in_export'), count: nullable(position) })),
});

export function sourcePackageShape(value: unknown): value is SourceImportPackageV1 {
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const item = pending.pop();
    if (!item || ++count > 4096 || item.depth > 12) return false;
    if (item.value !== null && typeof item.value === 'object') {
      const children: unknown[] = Array.isArray(item.value) ? item.value : Object.values(item.value);
      if (children.length > (Array.isArray(item.value) ? 256 : 16)) return false;
      for (const child of children) pending.push({ value: child, depth: item.depth + 1 });
    }
  }
  return root(value);
}
