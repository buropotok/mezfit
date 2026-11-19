// SourceImportPackage v1. Normative semantics in docs/architecture/migration-source-contract.md.
export interface SourceImportPackageV1 {
  kind: 'mezfit.source-import';
  schemaVersion: 1;
  provenance: SourceProvenance;
  coverage: SourceCoverage;
  subjects: SourceSubject[];
  sourceExercises: SourceExercise[];
  programs: SourceProgram[];
  scheduledWorkouts: SourceScheduledWorkout[];
  sessions: SourceSession[];
  issues: SourceImportIssue[];
  omittedData: OmittedDataSummary[];
}

export interface SourceProvenance {
  sourceApp: string;
  formatFamily: string;
  formatVersion: string | null;
  adapterId: string;
  adapterVersion: string;
  inputSha256: string; // 64 lowercase hexadecimal chars
  exportKind: 'full_backup' | 'training_history'
    | 'program_only' | 'mixed' | 'unknown';
}

export type SourceCoverageState = 'complete' | 'partial'
  | 'not_in_export' | 'unknown';

export interface SourceCoverage {
  subjects: SourceCoverageState;
  sourceExercises: SourceCoverageState;
  programs: SourceCoverageState;
  scheduledWorkouts: SourceCoverageState;
  sessions: SourceCoverageState;
  measures: SourceCoverageState;
}

export type SourceRef =
  | { state: 'linked'; sourceKey: string }
  | { state: 'none' }
  | { state: 'unknown' };

export interface SourceMeasurement {
  value: number;
  unit: string | null;
}

export interface SourceSetMetrics {
  reps: number | null;
  weight: SourceMeasurement | null;
  duration: SourceMeasurement | null;
  distance: SourceMeasurement | null;
}

export interface SourceWorkoutTiming {
  localDate: string | null;          // YYYY-MM-DD, если достоверна
  startedAtUtc: string | null;       // UTC instant, если достоверен
  completedAtUtc: string | null;     // UTC instant, если достоверен
  timeZone: string | null;           // исходная IANA zone, если известна
  precision: 'instant' | 'minute' | 'date' | 'unknown';
}

// Только явно извлечённое скалярное поле; не свободный JSON/Blob.
// Единица обязательна как поле для числового варианта, но может быть null.
export type SourceAttribute =
  | { name: string; kind: 'string'; value: string }
  | { name: string; kind: 'number'; value: number; unit: string | null }
  | { name: string; kind: 'boolean'; value: boolean }
  | { name: string; kind: 'null'; value: null };

export interface SourceSubject {
  sourceKey: string;
  displayName: string | null;
  sourceContainerKeys: string[];
  sourceAttributes: SourceAttribute[];
}

export interface SourceExercise {
  sourceKey: string;
  sourceName: string | null;
  aliases: string[];
  equipment: string | null;
  movementType: string | null;
  bodyPart: string | null;
  primaryMuscles: string[];
  trackingHint: 'weight_reps' | 'time' | 'time_distance'
    | 'time_reps' | 'time_weight' | null;
  sourceAttributes: SourceAttribute[];
}

export interface SourceProgram {
  sourceKey: string;
  subjectRef: SourceRef;
  name: string | null;
  phases: SourcePhase[];
  days: SourceProgramDay[];
  sourceAttributes: SourceAttribute[];
}

export interface SourcePhase {
  sourceKey: string;
  name: string | null;
  position: number;
  sourceAttributes: SourceAttribute[];
}

export interface SourceProgramDay {
  sourceKey: string;
  phaseRef: SourceRef;               // none, если фаз в источнике нет
  name: string | null;
  position: number;
  exercises: SourceProgramExercise[];
  sourceAttributes: SourceAttribute[];
}

export interface SourceProgramExercise {
  sourceKey: string;
  exerciseSourceKey: string;
  position: number;
  notes: string | null;
  sets: SourceProgramSet[];
  sourceAttributes: SourceAttribute[];
}

export interface SourceProgramSet {
  sourceKey: string;
  position: number;
  sourceSetType: string | null;
  sourceSetLabel: string | null;
  comment: string | null;
  sourceAttributes: SourceAttribute[];
  // НЕТ числовых planned*/actual* полей.
}

export type SourcePlanPresence =
  | { state: 'present'; exercises: SourcePlanExercise[] }
  | { state: 'absent' }
  | { state: 'unknown' };

export interface SourceScheduledWorkout {
  sourceKey: string;
  subjectRef: SourceRef;
  programRef: SourceRef;
  programDayRef: SourceRef;
  name: string | null;
  timing: SourceWorkoutTiming;
  plan: SourcePlanPresence;
  sourceAttributes: SourceAttribute[];
}

export interface SourcePlanExercise {
  sourceKey: string;
  exerciseSourceKey: string;
  sourceProgramExerciseRef: SourceRef;
  position: number;
  sets: SourcePlanSet[];
}

export interface SourcePlanSet {
  sourceKey: string;
  sourceProgramSetRef: SourceRef;
  position: number;
  sourceSetType: string | null;
  metrics: SourceSetMetrics; // числовые значения PLAN — здесь
}

export interface SourceSession {
  sourceKey: string;
  subjectRef: SourceRef;
  scheduledWorkoutRef: SourceRef;
  programRef: SourceRef;
  name: string | null;
  timing: SourceWorkoutTiming;
  completionState: 'completed' | 'in_progress' | 'unknown';
  frozenPlan: SourcePlanPresence;
  performedExercises: SourcePerformedExercise[];
  sourceAttributes: SourceAttribute[];
}

export interface SourcePerformedExercise {
  sourceKey: string;
  exerciseSourceKey: string;
  position: number;
  notes: string | null;
  sets: SourceFactSet[];
}

export interface SourceFactSet {
  sourceKey: string;
  position: number;
  planSetRef: SourceRef;
  sourceSetType: string | null;
  sourceSetLabel: string | null;
  metrics: SourceSetMetrics;           // отдельный FACT
  setStatus: 'pending' | 'completed' | 'skipped' | 'unknown';
  rpe: number | null;
  comment: string | null;
  sourceAttributes: SourceAttribute[];
}

export interface SourceImportIssue {
  code: string; // стабильный код из reviewed allowlist
  severity: 'info' | 'warning' | 'error';
  entityType: string | null;
  sourceKey: string | null;
  field: string | null;
}

export interface OmittedDataSummary {
  category: string;                 // например 'measures'
  reason: 'unsupported_target' | 'unreadable' | 'not_in_export';
  count: number | null;
}
