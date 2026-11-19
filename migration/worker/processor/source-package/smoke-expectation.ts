import type { Success } from '../contracts';
import { TRAINING_FORMAT } from '../adapters/training';
import type { SourceImportPackageV1, SourceRef, SourceSetMetrics, SourceWorkoutTiming } from './types';

const none = (): SourceRef => ({ state: 'none' });
const linked = (sourceKey: string): SourceRef => ({ state: 'linked', sourceKey });
const timing = (localDate: string): SourceWorkoutTiming => ({ localDate, startedAtUtc: null,
  completedAtUtc: null, timeZone: null, precision: 'date' });
const load = (reps: number, value: number): SourceSetMetrics => ({ reps, weight: { value, unit: 'kg' }, duration: null, distance: null });

// Independent canonical expectation: no invocation of adapter.parse(), and no
// derivation of expected fields/refs from the source fixture at smoke runtime.
export function expectedTrainingPackage(inputSha256: string): SourceImportPackageV1 {
  return {
    kind: 'mezfit.source-import', schemaVersion: 1,
    provenance: { sourceApp: 'synthetic-training', formatFamily: 'mezfit-synthetic-training', formatVersion: '1',
      adapterId: 'synthetic-training', adapterVersion: '1.0.0', inputSha256, exportKind: 'mixed' },
    coverage: { subjects: 'complete', sourceExercises: 'complete', programs: 'partial', scheduledWorkouts: 'partial', sessions: 'partial', measures: 'partial' },
    subjects: [
      { sourceKey: 'subject:p', displayName: 'Synthetic Person', sourceContainerKeys: [], sourceAttributes: [] },
      { sourceKey: 'subject:q', displayName: 'Other Person', sourceContainerKeys: [], sourceAttributes: [] },
    ],
    sourceExercises: [
      { sourceKey: 'exercise:bench', sourceName: 'Source press', aliases: [], equipment: null, movementType: null,
        bodyPart: null, primaryMuscles: [], trackingHint: 'weight_reps', sourceAttributes: [] },
      { sourceKey: 'exercise:hold', sourceName: 'Source hold', aliases: [], equipment: null, movementType: null,
        bodyPart: null, primaryMuscles: [], trackingHint: 'time', sourceAttributes: [] },
    ],
    programs: [
      { sourceKey: 'program:p1', subjectRef: linked('subject:p'), name: null, sourceAttributes: [],
        phases: [{ sourceKey: 'phase:phase', name: 'Phase', position: 0, sourceAttributes: [] }],
        days: [{ sourceKey: 'day:day', phaseRef: linked('phase:phase'), name: null, position: 0, sourceAttributes: [],
          exercises: [{ sourceKey: 'programExercise:pe', exerciseSourceKey: 'exercise:bench', position: 0, notes: null, sourceAttributes: [],
            sets: [{ sourceKey: 'programSet:ps', position: 0, sourceSetType: null, sourceSetLabel: null, comment: null,
              sourceAttributes: [
                { name: 'source_planned_reps', kind: 'number', value: 10, unit: 'reps' },
                { name: 'source_planned_weight', kind: 'number', value: 80, unit: 'kg' },
              ] }] }] }] },
      { sourceKey: 'program:p2', subjectRef: linked('subject:q'), name: null, sourceAttributes: [], phases: [],
        days: [{ sourceKey: 'day:day2', phaseRef: none(), name: null, position: 0, sourceAttributes: [],
          exercises: [{ sourceKey: 'programExercise:pe2', exerciseSourceKey: 'exercise:hold', position: 0, notes: null, sourceAttributes: [],
            sets: [{ sourceKey: 'programSet:ps2', position: 0, sourceSetType: null, sourceSetLabel: null, comment: null, sourceAttributes: [] }] }] }] },
    ],
    scheduledWorkouts: [{ sourceKey: 'scheduledWorkout:w', subjectRef: linked('subject:p'), programRef: linked('program:p1'),
      programDayRef: linked('day:day'), name: null, timing: timing('2026-10-14'), sourceAttributes: [],
      plan: { state: 'present', exercises: [{ sourceKey: 'planExercise:oe', exerciseSourceKey: 'exercise:bench',
        sourceProgramExerciseRef: linked('programExercise:pe'), position: 0,
        sets: [{ sourceKey: 'planSet:os', sourceProgramSetRef: { state: 'unknown' }, position: 0, sourceSetType: null, metrics: load(10, 25) }] }] } }],
    sessions: [
      { sourceKey: 'session:s', subjectRef: linked('subject:p'), programRef: linked('program:p1'), scheduledWorkoutRef: linked('scheduledWorkout:w'),
        name: null, timing: timing('2026-10-14'), completionState: 'completed', sourceAttributes: [],
        frozenPlan: { state: 'present', exercises: [{ sourceKey: 'planExercise:se', exerciseSourceKey: 'exercise:bench',
          sourceProgramExerciseRef: linked('programExercise:pe'), position: 0,
          sets: [{ sourceKey: 'planSet:ss', sourceProgramSetRef: linked('programSet:ps'), position: 0, sourceSetType: null, metrics: load(10, 25) }] }] },
        performedExercises: [{ sourceKey: 'performedExercise:fe', exerciseSourceKey: 'exercise:bench', position: 0, notes: null,
          sets: [{ sourceKey: 'factSet:fs', position: 0, planSetRef: linked('planSet:ss'), sourceSetType: null, sourceSetLabel: null,
            metrics: load(8, 20), setStatus: 'completed', rpe: null, comment: null, sourceAttributes: [] }] }] },
      { sourceKey: 'session:ad', subjectRef: linked('subject:p'), programRef: none(), scheduledWorkoutRef: none(),
        name: null, timing: timing('2026-10-15'), completionState: 'completed', sourceAttributes: [], frozenPlan: { state: 'absent' },
        performedExercises: [{ sourceKey: 'performedExercise:afe', exerciseSourceKey: 'exercise:hold', position: 0, notes: null,
          sets: [{ sourceKey: 'factSet:afs', position: 0, planSetRef: none(), sourceSetType: null, sourceSetLabel: null,
            metrics: { reps: null, weight: null, duration: { value: 30, unit: null }, distance: null },
            setStatus: 'completed', rpe: null, comment: null, sourceAttributes: [] }] }] },
    ],
    issues: [
      { code: 'SOURCE_PROGRAM_NUMERIC_PRESCRIPTION', severity: 'warning', entityType: 'programSet', sourceKey: 'programSet:ps', field: 'source_planned_reps' },
      { code: 'SOURCE_PROGRAM_NUMERIC_PRESCRIPTION', severity: 'warning', entityType: 'programSet', sourceKey: 'programSet:ps', field: 'source_planned_weight' },
      { code: 'UNKNOWN_UNIT', severity: 'warning', entityType: 'factSet', sourceKey: 'factSet:afs', field: 'duration' },
      { code: 'OMITTED_MEASURES', severity: 'info', entityType: null, sourceKey: null, field: 'measures' },
    ], omittedData: [{ category: 'measures', reason: 'unsupported_target', count: 2 }],
  };
}

// Comparison ignores JSON object property order, while preserving array order.
export function canonicalSourceJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalSourceJson).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => JSON.stringify(key) + ':' + canonicalSourceJson(item)).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
}
export function matchesTrainingFixture(result: Success): boolean {
  return result.schemaVersion === 3 && result.detectedFormat === TRAINING_FORMAT
    && result.adapter.id === 'synthetic-training' && result.adapter.version === '1.0.0'
    && result.summary.warningsCount === 3
    && JSON.stringify(result.warnings) === JSON.stringify(['OMITTED_MEASURES', 'SOURCE_PROGRAM_NUMERIC_PRESCRIPTION', 'UNKNOWN_UNIT'])
    && canonicalSourceJson(result.sourcePackage) === canonicalSourceJson(expectedTrainingPackage(result.inputSha256));
}
