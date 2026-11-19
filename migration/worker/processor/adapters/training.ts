import { PROCESSOR_INPUT_LIMIT } from '../../../processor-protocol.mjs';
import { exactKeys, jsonMarker, ProcessingFailure, record, type AdapterData, type AdapterInput, type ImportAdapter } from '../contracts';
import { isSourceImportPackage, requiredSourceIssues } from '../source-package/validate';
import type { SourceImportPackageV1, SourceRef, SourcePlanPresence, SourceSetMetrics, SourceAttribute } from '../source-package/types';

export const TRAINING_FORMAT = 'mezfit-synthetic-training-v1';
const FAMILY = 'mezfit-synthetic-training';
function fail(): never { throw new ProcessingFailure('INVALID_INPUT_SCHEMA'); }
function array(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 32) return fail();
  return value;
}
function tuple(value: unknown, length: number): unknown[] {
  const row = array(value);
  if (row.length !== length) return fail();
  return row;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.length || value.length > 96) return fail();
  return value;
}
function number(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fail();
  return value;
}
const key = (kind: string, value: unknown) => kind + ':' + text(value);
function ref(kind: string, value: unknown): SourceRef {
  if (value === null) return { state: 'none' };
  if (value === '?') return { state: 'unknown' };
  return { state: 'linked', sourceKey: key(kind, value) };
}
function loadMetrics(reps: unknown, weight: unknown, unit: unknown): SourceSetMetrics {
  const count = number(reps);
  if (count !== null && !Number.isSafeInteger(count)) return fail();
  const load = number(weight);
  return { reps: count, weight: load === null ? null : { value: load, unit: unit === null ? null : text(unit) },
    duration: null, distance: null };
}
function metrics(value: unknown): SourceSetMetrics {
  const [reps, weight, unit, duration, timeUnit, distance, distanceUnit] = tuple(value, 7);
  const result = loadMetrics(reps, weight, unit);
  const time = number(duration), length = number(distance);
  return { ...result, duration: time === null ? null : { value: time, unit: timeUnit === null ? null : text(timeUnit) },
    distance: length === null ? null : { value: length, unit: distanceUnit === null ? null : text(distanceUnit) } };
}
function plan(value: unknown): SourcePlanPresence {
  if (value === null) return { state: 'absent' };
  if (value === '?') return { state: 'unknown' };
  return { state: 'present', exercises: array(value).map((entry, position) => {
    const [id, definition, programMove, sets] = tuple(entry, 4);
    return { sourceKey: key('planExercise', id), exerciseSourceKey: key('exercise', definition), position,
      sourceProgramExerciseRef: ref('programExercise', programMove),
      sets: array(sets).map((entry, position) => {
        const [id, programSet, values] = tuple(entry, 3);
        return { sourceKey: key('planSet', id), sourceProgramSetRef: ref('programSet', programSet), position,
          sourceSetType: null, metrics: metrics(values) };
      }) };
  }) };
}
function timing(value: unknown): SourceImportPackageV1['sessions'][number]['timing'] {
  return { localDate: text(value), startedAtUtc: null, completedAtUtc: null, timeZone: null, precision: 'date' };
}

function parse(input: AdapterInput): AdapterData {
  const data = input.json;
  if (!record(data) || !exactKeys(data, ['format', 'people', 'exercises', 'templates', 'appointments', 'history', 'measures'])
    || data.format !== TRAINING_FORMAT || typeof input.inputSha256 !== 'string') return fail();
  const pkg: SourceImportPackageV1 = {
    kind: 'mezfit.source-import', schemaVersion: 1,
    provenance: { sourceApp: 'synthetic-training', formatFamily: FAMILY, formatVersion: '1',
      adapterId: 'synthetic-training', adapterVersion: '1.0.0', inputSha256: input.inputSha256, exportKind: 'mixed' },
    coverage: { subjects: 'complete', sourceExercises: 'complete', programs: 'partial', scheduledWorkouts: 'partial',
      sessions: 'partial', measures: 'partial' },
    subjects: array(data.people).map(entry => {
      const [id, name] = tuple(entry, 2);
      return { sourceKey: key('subject', id), displayName: name === null ? null : text(name),
        sourceContainerKeys: [], sourceAttributes: [] };
    }),
    sourceExercises: array(data.exercises).map(entry => {
      const [id, name, mode] = tuple(entry, 3);
      if (mode !== 'load' && mode !== 'duration' && mode !== null) return fail();
      return { sourceKey: key('exercise', id), sourceName: text(name), aliases: [], equipment: null,
        movementType: null, bodyPart: null, primaryMuscles: [], trackingHint: mode === 'load' ? 'weight_reps' : mode === 'duration' ? 'time' : null,
        sourceAttributes: [] };
    }),
    programs: array(data.templates).map(entry => {
      const [id, person, phases, days] = tuple(entry, 4);
      return { sourceKey: key('program', id), subjectRef: ref('subject', person), name: null, sourceAttributes: [],
        phases: array(phases).map((entry, position) => {
          const [id, name] = tuple(entry, 2);
          return { sourceKey: key('phase', id), name: text(name), position, sourceAttributes: [] };
        }),
        days: array(days).map((entry, position) => {
          const [id, phase, moves] = tuple(entry, 3);
          return { sourceKey: key('day', id), phaseRef: ref('phase', phase), name: null, position, sourceAttributes: [],
            exercises: array(moves).map((entry, position) => {
              const [id, definition, sets] = tuple(entry, 3);
              return { sourceKey: key('programExercise', id), exerciseSourceKey: key('exercise', definition), position,
                notes: null, sourceAttributes: [], sets: array(sets).map((entry, position) => {
                  const [id, reps, weight, unit] = tuple(entry, 4);
                  const numeric = loadMetrics(reps, weight, unit);
                  const sourceAttributes: SourceAttribute[] = [];
                  if (numeric.reps !== null) sourceAttributes.push({ name: 'source_planned_reps', kind: 'number', value: numeric.reps, unit: 'reps' });
                  if (numeric.weight) sourceAttributes.push({ name: 'source_planned_weight', kind: 'number',
                    value: numeric.weight.value, unit: numeric.weight.unit });
                  return { sourceKey: key('programSet', id), position, sourceSetType: null, sourceSetLabel: null,
                    comment: null, sourceAttributes };
                }) };
            }) };
        }) };
    }),
    scheduledWorkouts: array(data.appointments).map(entry => {
      const [id, person, program, day, date, prescription] = tuple(entry, 6);
      return { sourceKey: key('scheduledWorkout', id), subjectRef: ref('subject', person), programRef: ref('program', program),
        programDayRef: ref('day', day), name: null, timing: timing(date), plan: plan(prescription), sourceAttributes: [] };
    }),
    sessions: array(data.history).map(entry => {
      const [id, person, program, scheduled, date, snapshot, performed] = tuple(entry, 7);
      return { sourceKey: key('session', id), subjectRef: ref('subject', person), programRef: ref('program', program),
        scheduledWorkoutRef: ref('scheduledWorkout', scheduled), name: null, timing: timing(date), completionState: 'completed',
        frozenPlan: plan(snapshot), performedExercises: array(performed).map((entry, position) => {
          const [id, definition, sets] = tuple(entry, 3);
          return { sourceKey: key('performedExercise', id), exerciseSourceKey: key('exercise', definition), position,
            notes: null, sets: array(sets).map((entry, position) => {
              const [id, planId, values] = tuple(entry, 3);
              return { sourceKey: key('factSet', id), position, planSetRef: ref('planSet', planId),
                sourceSetType: null, sourceSetLabel: null, metrics: metrics(values),
                setStatus: 'completed', rpe: null, comment: null, sourceAttributes: [] };
            }) };
        }), sourceAttributes: [] };
    }),
    issues: [], omittedData: [{ category: 'measures', reason: 'unsupported_target', count: number(data.measures) }],
  };
  if (pkg.omittedData[0].count !== null && !Number.isSafeInteger(pkg.omittedData[0].count)) return fail();
  pkg.issues = requiredSourceIssues(pkg);
  pkg.issues.push({ code: 'OMITTED_MEASURES', severity: 'info', entityType: null, sourceKey: null, field: 'measures' });
  if (!isSourceImportPackage(pkg)) throw new ProcessingFailure('INVALID_SOURCE_PACKAGE');
  return { recordsValidated: pkg.sessions.length + pkg.programs.length + pkg.scheduledWorkouts.length,
    warnings: [...new Set(pkg.issues.map(issue => issue.code))].sort(), normalized: null, sourcePackage: pkg };
}
function validate(value: unknown): value is AdapterData {
  return record(value) && exactKeys(value, ['recordsValidated', 'warnings', 'normalized', 'sourcePackage'])
    && value.normalized === null && isSourceImportPackage(value.sourcePackage)
    && value.sourcePackage.provenance.sourceApp === 'synthetic-training' && value.sourcePackage.provenance.formatVersion === '1'
    && value.sourcePackage.provenance.exportKind === 'mixed'
    && value.recordsValidated === value.sourcePackage.sessions.length + value.sourcePackage.programs.length + value.sourcePackage.scheduledWorkouts.length
    && JSON.stringify(value.warnings) === JSON.stringify([...new Set(value.sourcePackage.issues.map(issue => issue.code))].sort());
}
export const trainingAdapter: ImportAdapter = Object.freeze({
  descriptor: Object.freeze({ adapterId: 'synthetic-training', adapterVersion: '1.0.0', format: TRAINING_FORMAT,
    formatFamily: FAMILY, registration: 'reviewed', detection: 'bounded-json-marker',
    maxInputBytes: PROCESSOR_INPUT_LIMIT, maxRecords: 32, resultSchemaVersion: 3 }),
  detect: (input: AdapterInput) => jsonMarker(input.json, TRAINING_FORMAT, FAMILY), parse, validate,
});
