import type { SourceImportPackageV1, SourceRef, SourceWorkoutTiming, SourceSetMetrics } from '../worker/processor/source-package/types';
import type { BuildMezfitImportPlanInput } from './types';

const linked = (sourceKey: string): SourceRef => ({ state: 'linked', sourceKey });
const none = (): SourceRef => ({ state: 'none' });
const metric = (reps: number | null, weight: number | null, unit = 'kg'): SourceSetMetrics => ({
  reps, weight: weight === null ? null : { value: weight, unit }, duration: null, distance: null,
});
const instant = (date: string, hour: number, endHour: number | null): SourceWorkoutTiming => ({
  localDate: date, startedAtUtc: date + 'T' + String(hour).padStart(2, '0') + ':00:00.000Z',
  completedAtUtc: endHour === null ? null : date + 'T' + String(endHour).padStart(2, '0') + ':00:00.000Z',
  timeZone: 'UTC', precision: 'instant',
});

/** Independent MIG-05 canonical fixture, not derived from the training adapter. */
export function businessPackage(): SourceImportPackageV1 {
  return {
    kind: 'mezfit.source-import', schemaVersion: 1,
    provenance: { sourceApp: 'test-diary', formatFamily: 'test-family', formatVersion: '1',
      adapterId: 'reviewed-test', adapterVersion: '1.0.0', inputSha256: 'a'.repeat(64),
      exportKind: 'mixed' },
    coverage: { subjects: 'complete', sourceExercises: 'complete', programs: 'complete',
      scheduledWorkouts: 'complete', sessions: 'complete', measures: 'complete' },
    subjects: [{ sourceKey: 'subject:p', displayName: 'Fixture athlete',
      sourceContainerKeys: [], sourceAttributes: [] }],
    sourceExercises: [
      { sourceKey: 'ex:bench', sourceName: 'Bench Press', aliases: [], equipment: 'barbell',
        movementType: null, bodyPart: null, primaryMuscles: [],
        trackingHint: 'weight_reps', sourceAttributes: [] },
      { sourceKey: 'ex:hold', sourceName: 'Static hold', aliases: [], equipment: null,
        movementType: null, bodyPart: null, primaryMuscles: [],
        trackingHint: 'time', sourceAttributes: [] },
    ],
    programs: [{
      sourceKey: 'p:old', subjectRef: linked('subject:p'), name: 'Older training plan',
      sourceAttributes: [{ name: 'created_year', kind: 'string', value: '2022' }],
      phases: [{ sourceKey: 'phase:a', name: 'Block', position: 0, sourceAttributes: [] }],
      days: [{
        sourceKey: 'day:a', phaseRef: linked('phase:a'), name: 'Full body', position: 0,
        sourceAttributes: [], exercises: [
          { sourceKey: 'pe:bench', exerciseSourceKey: 'ex:bench', position: 0, notes: null,
            sourceAttributes: [], sets: [
              { sourceKey: 'ps:1', position: 0, sourceSetType: null, sourceSetLabel: 'warmup',
                comment: null, sourceAttributes: [] },
              { sourceKey: 'ps:2', position: 1, sourceSetType: null, sourceSetLabel: 'normal',
                comment: 'Slow eccentric', sourceAttributes: [] },
            ] },
          { sourceKey: 'pe:hold', exerciseSourceKey: 'ex:hold', position: 1, notes: 'Hold',
            sourceAttributes: [], sets: [{ sourceKey: 'ps:3', position: 0,
              sourceSetType: null, sourceSetLabel: null, comment: null, sourceAttributes: [] }] },
        ],
      }],
    }],
    scheduledWorkouts: [
      { sourceKey: 'sw:linked', subjectRef: linked('subject:p'), programRef: linked('p:old'),
        programDayRef: linked('day:a'), name: 'Day A',
        timing: instant('2026-10-10', 9, null), sourceAttributes: [],
        plan: { state: 'present', exercises: [{
          sourceKey: 'op:e1', position: 0, exerciseSourceKey: 'ex:bench',
          sourceProgramExerciseRef: linked('pe:bench'),
          sets: [{ sourceKey: 'op:s1', sourceProgramSetRef: linked('ps:1'), position: 0,
            sourceSetType: null, metrics: metric(10, 100, 'lb') }],
        }] } },
      { sourceKey: 'sw:solo', subjectRef: linked('subject:p'), programRef: linked('p:old'),
        programDayRef: linked('day:a'), name: 'Scheduled independently',
        timing: instant('2026-10-12', 15, null), sourceAttributes: [],
        plan: { state: 'present', exercises: [{
          sourceKey: 'op:e2', position: 0, exerciseSourceKey: 'ex:bench',
          sourceProgramExerciseRef: linked('pe:bench'),
          sets: [{ sourceKey: 'op:s2', sourceProgramSetRef: linked('ps:2'), position: 0,
            sourceSetType: null, metrics: metric(12, 0) }],
        }] } },
    ],
    sessions: [
      { sourceKey: 'ses:linked', subjectRef: linked('subject:p'),
        scheduledWorkoutRef: linked('sw:linked'), programRef: linked('p:old'), name: 'Done from program',
        timing: instant('2026-10-10', 9, 10), completionState: 'completed', sourceAttributes: [],
        frozenPlan: { state: 'present', exercises: [{
          sourceKey: 'fp:e1', position: 0, exerciseSourceKey: 'ex:bench',
          sourceProgramExerciseRef: linked('pe:bench'),
          sets: [{ sourceKey: 'fp:s1', position: 0, sourceSetType: null,
            sourceProgramSetRef: linked('ps:1'), metrics: metric(10, 50) }],
        }] },
        performedExercises: [{
          sourceKey: 'fx:e1', position: 0, exerciseSourceKey: 'ex:bench', notes: null,
          sets: [{ sourceKey: 'fx:s1', position: 0, planSetRef: linked('fp:s1'),
            sourceSetType: null, sourceSetLabel: null, metrics: metric(8, 55),
            setStatus: 'completed', rpe: 7, comment: null, sourceAttributes: [] }],
        }],
      },
      { sourceKey: 'ses:adhoc', subjectRef: linked('subject:p'), scheduledWorkoutRef: none(),
        programRef: none(), name: 'Independent history', timing: instant('2026-10-11', 11, 12),
        completionState: 'completed', sourceAttributes: [], frozenPlan: { state: 'absent' },
        performedExercises: [{
          sourceKey: 'fx:e2', position: 0, exerciseSourceKey: 'ex:hold', notes: null,
          sets: [{ sourceKey: 'fx:s2', position: 0, planSetRef: none(),
            sourceSetType: null, sourceSetLabel: null,
            metrics: { reps: null, weight: null, duration: { value: 1, unit: 'min' }, distance: null },
            setStatus: 'completed', rpe: null, comment: null, sourceAttributes: [] }],
        }],
      },
    ],
    issues: [], omittedData: [{ category: 'measures', reason: 'unsupported_target', count: 3 }],
  };
}

export function businessInput(): BuildMezfitImportPlanInput {
  return {
    sourcePackage: businessPackage(),
    period: { fromDate: '2026-10-01', throughDate: '2026-10-31', selectionTimeZone: 'Europe/Warsaw' },
    evaluatedAtUtc: '2026-11-20T10:00:00.000Z', policyVersion: 'MIG-05/v1',
    targetContextSnapshot: { datasetKey: 'source-dataset-2026', bindings: [{
      sourceSubjectKey: 'subject:p', kind: 'provisional_imported_client', provisionalKey: 'opaque-athlete-context',
    }], activeProgramSubjectKeys: [] },
    catalogueSnapshot: { completeness: 'complete', entries: [{
      id: '0001', scope: 'public', name: 'Bench Press', equipment: 'barbell', trackingType: 'weight_reps',
    }] },
    mappingSnapshot: { entries: [] },
    calendarOccupancySnapshot: { intervals: [] },
    existingImportsSnapshot: { identities: [] },
    selectionSnapshot: { exclusions: [] },
  };
}
