import type {
  SourceImportPackageV1, SourceRef, SourceWorkoutTiming, SourceAttribute, SourceSetMetrics,
  SourceFactSet,
} from '../worker/processor/source-package/types';

/** The mapping engine has no Dexie/Worker dependencies and conveys no write permission. */
export type ExerciseTracking = 'weight_reps' | 'time' | 'time_distance' | 'time_reps' | 'time_weight';
export type ImportEntityKind = 'program' | 'session' | 'scheduledWorkout' | 'customExercise' | 'provenance';
export type ImportSelectionState = 'selected' | 'excluded_by_coach' | 'blocked' | 'already_imported';
export type ImportReadiness = 'ready_for_review' | 'requires_decisions' | 'blocked';
export type IssueCode =
  | 'UNKNOWN_BUSINESS_DATE' | 'UNKNOWN_SOURCE_TIMEZONE' | 'MISSING_SOURCE_REFERENCE'
  | 'UNRESOLVED_SUBJECT' | 'UNKNOWN_PROGRAM_RELATION' | 'ACTIVE_PROGRAM_CONFLICT'
  | 'UNKNOWN_COMPLETION' | 'SCHEDULE_LINK_UNCERTAIN' | 'SCHEDULE_END_UNKNOWN'
  | 'MISSING_EXERCISE' | 'UNRESOLVED_EXERCISE' | 'UNKNOWN_TRACKING'
  | 'UNSUPPORTED_UNIT' | 'TRACKING_METRICS_CONFLICT' | 'UNSUPPORTED_SET_METADATA'
  | 'UNSUPPORTED_SOURCE_ATTRIBUTES' | 'SOURCE_PROGRAM_NUMERIC_PRESCRIPTION'
  | 'AMBIGUOUS_LAST_SESSION' | 'NO_COMPLETED_SESSION' | 'TIME_INFERRED'
  | 'TIME_COLLISION' | 'TIME_SLOT_EXHAUSTED' | 'TIME_DURATION_UNKNOWN'
  | 'INVALID_DEPENDENCY' | 'BLOCKED_DEPENDENCY' | 'UNKNOWN_PLAN'
  | 'UNSUPPORTED_FACT_STATUS' | 'OMITTED_MEASURES';

export interface MappingIssue {
  code: IssueCode;
  severity: 'info' | 'warning' | 'error';
  entityKind: ImportEntityKind | 'source';
  /** Private provenance only. Never emit source refs/names into CI traces. */
  sourceKey: string | null;
  operationKey: string | null;
}

export interface ImportPeriod {
  fromDate: string;
  throughDate: string;
  selectionTimeZone: string;
}

export interface TargetContextSnapshot {
  datasetKey: string;
  /** Each linked source subject must have one explicit planning binding. */
  bindings: Array<
    | { sourceSubjectKey: string; kind: 'existing_client'; targetClientId: string }
    | { sourceSubjectKey: string; kind: 'provisional_imported_client'; provisionalKey: string }
    | { sourceSubjectKey: string; kind: 'unresolved' }
  >;
  /** A conflict does not authorize an overwrite or implicit merge. */
  activeProgramSubjectKeys: string[];
}

export interface CatalogueSnapshot {
  completeness: 'complete' | 'partial' | 'unknown';
  entries: Array<{
    id: string;
    scope: 'public' | 'coach';
    name: string;
    equipment: string | null;
    trackingType: ExerciseTracking;
  }>;
}

export interface MappingSnapshot {
  /** Externally reviewed mapping registry. The target MUST exist in the catalogue snapshot. */
  entries: Array<{ identityKey: string; catalogueExerciseId: string }>;
}
export interface CalendarOccupancySnapshot {
  /** All occupied coach-resource intervals, across the coach's clients. */
  intervals: Array<{ startsAtUtc: string; endsAtUtc: string }>;
}
export interface ExistingImportsSnapshot {
  /** Includes dataset namespace and entity kind, never only an input file checksum. */
  identities: string[];
}
export interface CoachSelectionSnapshot {
  /** Future approval is a separate step; these are only preview exclusions. */
  exclusions: Array<{ kind: 'session' | 'scheduledWorkout' | 'program'; sourceKey: string }>;
}

export interface BuildMezfitImportPlanInput {
  sourcePackage: SourceImportPackageV1;
  period: ImportPeriod;
  evaluatedAtUtc: string;
  policyVersion: string;
  targetContextSnapshot: TargetContextSnapshot;
  catalogueSnapshot: CatalogueSnapshot;
  mappingSnapshot: MappingSnapshot;
  calendarOccupancySnapshot: CalendarOccupancySnapshot;
  existingImportsSnapshot: ExistingImportsSnapshot;
  selectionSnapshot: CoachSelectionSnapshot;
}

export type TargetBinding =
  | { key: string; sourceSubjectKey: string; kind: 'existing_client'; targetClientId: string }
  | { key: string; sourceSubjectKey: string; kind: 'provisional_imported_client'; provisionalKey: string }
  | { key: string; sourceSubjectKey: string; kind: 'unresolved' };

export type ExerciseMapping =
  | { identityKey: string; sourceExerciseKey: string; sourceSubjectKey: string; kind: 'catalog_match';
      catalogueExerciseId: string; trackingType: ExerciseTracking; matchEvidence: 'reviewed_registry' | 'exact_unique' }
  | { identityKey: string; sourceExerciseKey: string; sourceSubjectKey: string; kind: 'proposed_custom';
      operationKey: string; trackingType: ExerciseTracking; requiresReconciliation: true }
  | { identityKey: string; sourceExerciseKey: string; sourceSubjectKey: string; kind: 'blocked'; reason: IssueCode };

export interface ConvertedMeasurement {
  value: number;
  unit: 'kg' | 's' | 'm';
  originalValue: number;
  originalUnit: string;
  precision: number;
}
export interface ConvertedMetrics {
  reps: number | null;
  weight: ConvertedMeasurement | null;
  duration: ConvertedMeasurement | null;
  distance: ConvertedMeasurement | null;
}
export interface PlannedSet {
  sourceKey: string;
  position: number;
  sourceProgramSetRef: SourceRef;
  sourceSetType: string | null;
  sourceMetrics: SourceSetMetrics;
  metrics: ConvertedMetrics;
}
export interface PlannedExercise {
  sourceKey: string;
  position: number;
  exerciseMappingKey: string;
  sourceProgramExerciseRef: SourceRef;
  sets: PlannedSet[];
}
export type PlannedSnapshot =
  | { state: 'present'; exercises: PlannedExercise[] }
  | { state: 'absent' } | { state: 'unknown' };

export interface ProposedProgramSet {
  sourceKey: string;
  position: number;
  setType: string | null;
  setLabel: string | null;
  comment: string | null;
  /** Source-only numbers live here, never in numeric PROGRAM PLAN. */
  sourceAttributes: SourceAttribute[];
}
export interface ProposedProgramExercise {
  sourceKey: string;
  position: number;
  exerciseMappingKey: string;
  notes: string | null;
  sets: ProposedProgramSet[];
}
export interface ProposedProgramDay {
  sourceKey: string;
  position: number;
  phaseRef: SourceRef;
  name: string | null;
  exercises: ProposedProgramExercise[];
}
export interface ProposedProgram {
  sourceProgramKey: string | null;
  syntheticFromSessionKey: string | null;
  name: string | null;
  phases: Array<{ sourceKey: string; name: string | null; position: number }>;
  days: ProposedProgramDay[];
  intendedStatus: 'active';
}

export interface ConvertedFactSet {
  sourceKey: string;
  position: number;
  planSetRef: SourceRef;
  sourceSetType: string | null;
  sourceSetLabel: string | null;
  sourceMetrics: SourceSetMetrics;
  metrics: ConvertedMetrics;
  setStatus: SourceFactSet['setStatus'];
  rpe: number | null;
  comment: string | null;
  sourceAttributes: SourceAttribute[];
}
export interface PerformedExercise {
  sourceKey: string;
  position: number;
  exerciseMappingKey: string;
  notes: string | null;
  sets: ConvertedFactSet[];
}
export interface ImportTime {
  source: SourceWorkoutTiming;
  proposedStartsAtUtc: string | null;
  proposedEndsAtUtc: string | null;
  importTimeInferred: boolean;
  missed: 'missed' | 'not_missed' | 'undetermined' | 'not_applicable';
}

export interface ImportOperationBase {
  operationKey: string;
  targetBindingRef: string;
  sourceRefs: Array<{ kind: 'program' | 'session' | 'scheduledWorkout' | 'exercise'; sourceKey: string }>;
  dependencyKeys: string[];
  state: ImportSelectionState;
  reasonCodes: IssueCode[];
  /** Source evidence is private and must not be sent to a public trace. */
  evidence: { sourcePackageSha256: string; datasetKey: string };
  losses: IssueCode[];
}
export type ImportOperation =
  | (ImportOperationBase & { kind: 'program'; program: ProposedProgram })
  | (ImportOperationBase & { kind: 'historical_session'; name: string | null;
      completionState: SourceImportPackageV1['sessions'][number]['completionState'];
      programRef: SourceRef; scheduledWorkoutRef: SourceRef; timing: ImportTime; frozenPlan: PlannedSnapshot; fact: PerformedExercise[];
      importedProvenance: true })
  | (ImportOperationBase & { kind: 'standalone_scheduled'; name: string | null;
      programRef: SourceRef; programDayRef: SourceRef; timing: ImportTime; plan: PlannedSnapshot })
  | (ImportOperationBase & { kind: 'proposed_custom_exercise'; exerciseIdentityKey: string; sourceName: string;
      trackingType: ExerciseTracking; requiresReconciliation: true; targetScope: 'coach' })
  | (ImportOperationBase & { kind: 'provenance_metadata'; forOperationKey: string; marker: 'imported' });

export interface ImportSelection {
  groupKey: string;
  operationKeys: string[];
  state: ImportSelectionState;
  reasonCodes: IssueCode[];
  /** Dependencies whose selection must remain closed before publication. */
  dependencyClosure: string[];
}
export interface OmittedData {
  category: string;
  reason: 'unsupported_target' | 'unreadable' | 'not_in_export';
  count: number | null;
}
export interface ImportPreview {
  source: { sessions: number; scheduledWorkouts: number; programs: number; exercises: number };
  selected: { sessions: number; scheduledWorkouts: number; programs: number };
  outsidePeriod: { sessions: number; scheduledWorkouts: number };
  linkedScheduledSuppressed: number;
  blocked: number;
  excludedByCoach: number;
  alreadyImported: number;
  catalogMatched: number;
  proposedCustomExercises: number;
  convertedSets: number;
  incompleteSessions: number;
  omittedMeasures: number;
  issuesByCode: Array<{ code: IssueCode; count: number }>;
}
export interface MezfitImportPlanV1 {
  kind: 'mezfit.import-plan';
  schemaVersion: 1;
  planId: string;
  policyVersion: string;
  source: {
    packageSha256: string;
    datasetKey: string;
    sourceApp: string;
    formatFamily: string;
    adapterId: string;
    adapterVersion: string;
    inputSha256: string;
  };
  scope: ImportPeriod & {
    evaluatedAtUtc: string;
    selectedEntityTypes: ['session', 'scheduledWorkout'];
    programs: 'linked-only';
  };
  inputs: {
    catalogSnapshotHash: string;
    targetSnapshotHash: string;
    mappingSnapshotHash: string;
    occupancySnapshotHash: string;
    existingImportsSnapshotHash: string;
    selectionSnapshotHash: string;
  };
  targetBindings: TargetBinding[];
  exerciseMappings: ExerciseMapping[];
  operations: ImportOperation[];
  selections: ImportSelection[];
  issues: MappingIssue[];
  omittedData: OmittedData[];
  preview: ImportPreview;
  readiness: ImportReadiness;
}
