import { choice, count, date, digest, finite, instant, key, list, nonnegative, nullable, object, text, union, zone, type Rule, type Value } from './schema';

export const tracking = choice('weight_reps', 'time', 'time_distance', 'time_reps', 'time_weight');
export type Tracking = Value<typeof tracking>;
const opaque: Rule<string> = (value): value is string => key(value) && /^[a-zA-Z0-9_-]+$/.test(value);
const catalogueId: Rule<string> = (value): value is string => key(value) && !/^(tg:|rlm[-:])/i.test(value);
const note = nullable(text(1000));
const refs = list(digest, 512);
const nullableKey = nullable(key);
const selectionStatus = choice('selected', 'excluded_by_coach', 'blocked', 'already_imported', 'outside_period', 'represented_by_session');

const bindingFields = { subjectSourceKey: key, contextKey: opaque };
const binding = union(union(
  object({ kind: choice('existing_client'), ...bindingFields, activeProgram: choice('present', 'absent', 'unknown') }),
  object({ kind: choice('provisional_imported_client'), ...bindingFields }),
), object({ kind: choice('unresolved'), ...bindingFields }));
export type TargetBinding = Value<typeof binding>;

const catalogEntry = object({ id: catalogueId, name: text(1000, true), trackingType: tracking,
  equipment: nullableKey, movementType: nullableKey });
export const periodRule = object({ fromDate: date, throughDate: date, selectionTimeZone: zone });
export const snapshotRules = {
  targetSnapshot: nullable(list(binding, 32)),
  catalogueSnapshot: nullable(list(catalogEntry, 10_000)),
  mappingSnapshot: nullable(list(object({ exerciseKey: digest, catalogueId }), 512)),
  occupancySnapshot: nullable(list(object({ startsAtUtc: instant, endsAtUtc: instant }), 4096)),
  existingImportsSnapshot: nullable(list(digest, 2048)),
  excludedGroups: list(digest, 512),
};
export const configRule = object({ datasetKey: opaque, policyVersion: choice('mig-05.v1'),
  period: periodRule, evaluatedAtUtc: instant, ...snapshotRules });
export type ImportConfig = Value<typeof configRule>;
export type CatalogueEntry = Value<typeof catalogEntry>;

export const issueCode = choice(
  'UNKNOWN_DATE', 'INCONSISTENT_DATE', 'UNKNOWN_TIME_ZONE', 'NO_FREE_SLOT', 'OCCUPANCY_UNRESOLVED',
  'UNKNOWN_START', 'UNKNOWN_SCHEDULE_END', 'SESSION_LINK_UNCERTAIN', 'SESSION_NOT_COMPLETED',
  'UNRESOLVED_SUBJECT', 'UNRESOLVED_SOURCE_LINK', 'CONFLICTING_PROGRAM_LINK', 'UNRESOLVED_PROGRAM',
  'ACTIVE_PROGRAM_CONFLICT', 'PROGRAM_PRESENCE_UNKNOWN', 'LAST_SESSION_UNCERTAIN',
  'CATALOGUE_UNRESOLVED', 'INVALID_APPROVED_MAPPING', 'CUSTOM_EXERCISE_DATA_MISSING', 'CATALOGUE_AMBIGUOUS',
  'DEPENDENCY_BLOCKED', 'NO_SELECTED_DEPENDENT', 'UNSUPPORTED_SET_METADATA', 'UNSUPPORTED_UNIT', 'INCOMPATIBLE_METRICS', 'UNKNOWN_FROZEN_PLAN',
  'UNKNOWN_SCHEDULE_PLAN', 'UNSUPPORTED_FACT', 'SOURCE_ATTRIBUTE_OMITTED', 'MEASURES_OMITTED',
  'SOURCE_PROGRAM_NUMERIC_PRESCRIPTION', 'SOURCE_DIAGNOSTIC', 'SNAPSHOT_UNRESOLVED',
  'REPRESENTED_BY_SESSION', 'OUTSIDE_PERIOD', 'EXCLUDED_BY_COACH', 'ALREADY_IMPORTED',
);
export type IssueCode = Value<typeof issueCode>;
const sourceType = choice('session', 'scheduledWorkout', 'program', 'defaultProgram', 'exercise', 'subject');
export type SourceType = Value<typeof sourceType>;
const origin = object({ type: sourceType, sourceKey: key, subjectSourceKey: nullableKey });
const attribute = union(union(
  object({ name: key, kind: choice('string'), value: text(1000) }),
  object({ name: key, kind: choice('number'), value: finite, unit: nullableKey }),
), union(object({ name: key, kind: choice('boolean'), value: choice(true, false) }),
  object({ name: key, kind: choice('null'), value: choice(null) })));
const loss = object({ code: issueCode, entityKey: key, attribute: nullable(attribute) });
export type Loss = Value<typeof loss>;

const mappingFields = { mappingKey: digest, subjectKey: key, exerciseSourceKey: key };
const custom = object({ name: text(120, true), trackingType: tracking, requiresPostImportReconciliation: choice(true) });
const mapping = union(union(
  object({ kind: choice('catalogue'), ...mappingFields, target: catalogEntry, evidence: choice('approved_registry', 'exact_fingerprint') }),
  object({ kind: choice('proposed_custom'), ...mappingFields, definition: custom }),
), object({ kind: choice('unresolved'), ...mappingFields, reason: issueCode }));
export type ExerciseMapping = Value<typeof mapping>;

const sourceRef = union(object({ state: choice('unknown', 'none') }), object({ state: choice('linked'), sourceKey: key }));
const measurement = nullable(object({ value: nonnegative, unit: nullableKey }));
const rawMetrics = object({ reps: nullable(count), weight: measurement, duration: measurement, distance: measurement });
const normalizedMetrics = object({ reps: nullable(count), weightKg: nullable(nonnegative),
  durationSeconds: nullable(nonnegative), distanceMeters: nullable(nonnegative) });
const metrics = object({ original: rawMetrics, converted: nullable(normalizedMetrics) });
const timing = object({ localDate: nullable(date), startedAtUtc: nullable(instant), completedAtUtc: nullable(instant),
  timeZone: nullable(zone), precision: choice('date', 'instant', 'minute', 'unknown') });
const mappedTiming = object({ original: timing, businessDate: date, proposedStartUtc: nullable(instant),
  allocationEndsAtUtc: nullable(instant), importTimeInferred: choice(true, false) });
export type MappedTiming = Value<typeof mappedTiming>;

const ordered = { sourceKey: key, position: count };
const set = { ...ordered, sourceSetType: note };
const planSet = object({ ...set, sourceProgramSetRef: sourceRef, metrics });
const structuralSet = object({ ...set, sourceSetLabel: note, comment: note });
const factSet = object({ ...set, sourceSetLabel: note, comment: note, metrics, planSetRef: sourceRef,
  setStatus: choice('completed', 'pending', 'skipped', 'unknown'), rpe: nullable(nonnegative) });
const exercise = { ...ordered, exerciseSourceKey: key, mappingRef: digest };
const plan = union(object({ state: choice('absent', 'unknown') }),
  object({ state: choice('present'), exercises: list(object({
    ...exercise, sourceProgramExerciseRef: sourceRef, sets: list(planSet, 32),
  }), 32) }));
const phase = object({ ...ordered, name: note });
const day = object({ ...ordered, name: note, phaseRef: sourceRef,
  exercises: list(object({ ...exercise, notes: note, sets: list(structuralSet, 32) }), 32) });

const operation = { operationKey: digest, origin, targetBindingRef: opaque, dependencyKeys: refs,
  validation: choice('ready', 'blocked'), losses: list(loss, 4096) };
const program = object({ ...operation, kind: choice('program_structure'), name: note,
  activation: choice('undecided', 'proposed_active'), phases: list(phase, 32), days: list(day, 32) });
const workout = { ...operation, name: note, timing: nullable(mappedTiming), programRef: sourceRef,
  programDayRef: sourceRef, programOperationRef: nullable(digest) };
const session = object({ ...workout, kind: choice('historical_session'), occurrenceRef: sourceRef,
  lifecycle: choice('completed', 'in_progress', 'unknown'), imported: choice(true), frozenPlan: plan,
  fact: list(object({ ...exercise, notes: note, sets: list(factSet, 32) }), 32) });
const scheduled = object({ ...workout, kind: choice('standalone_scheduled'), plan,
  missed: choice('undetermined'), endsAtUtc: choice(null) });
const exerciseOperation = object({ ...operation, kind: choice('custom_exercise'), mappingRef: digest, definition: custom });
const metadata = object({ ...operation, kind: choice('provenance_metadata'), imported: choice(true) });
const operations = union(union(program, session), union(scheduled, union(exerciseOperation, metadata)));
export type ImportOperation = Value<typeof operations>;
export type ProgramOperation = Value<typeof program>;
export type SessionOperation = Value<typeof session>;
export type ScheduledOperation = Value<typeof scheduled>;
export type MappedPlan = Value<typeof plan>;
export type MappedMetrics = Value<typeof metrics>;

const selection = object({ groupKey: digest, origin, status: selectionStatus, reasons: list(issueCode, 48), dependencyKeys: refs });
export type ImportSelection = Value<typeof selection>;
const diagnostic = object({ code: issueCode, severity: choice('info', 'warning', 'error'), groupRef: nullable(digest) });
export type MappingIssue = Value<typeof diagnostic>;
const omitted = object({ category: key, reason: choice('unsupported_target', 'unreadable', 'not_in_export'), count: nullable(count) });
const preview = object({ sourceSessions: count, sourceScheduled: count, sourcePrograms: count, selected: count, blocked: count,
  excludedByCoach: count, outsidePeriod: count, alreadyImported: count, representedBySession: count,
  linkedPrograms: count, autoCreatedPrograms: count, catalogueMatches: count, customExercises: count,
  convertedSets: count, omittedMeasures: nullable(count) });

export const planRule = object({
  kind: choice('mezfit.import-plan'), schemaVersion: choice(1), planId: digest, policyVersion: choice('mig-05.v1'),
  source: object({ packageSha256: digest, datasetKey: opaque, sourceApp: key, formatFamily: key,
    formatVersion: nullableKey, adapterId: key, adapterVersion: key, inputSha256: digest, programCount: count }),
  scope: object({ fromDate: date, throughDate: date, selectionTimeZone: zone, evaluatedAtUtc: instant,
    programs: choice('linked-only'), selectedEntityTypes: object({ session: choice(true), scheduledWorkout: choice(true) }) }),
  inputs: object({ catalogueSnapshot: nullable(digest), targetSnapshot: nullable(digest), mappingSnapshot: nullable(digest),
    occupancySnapshot: nullable(digest), existingImportsSnapshot: nullable(digest), excludedGroups: digest }),
  targetBindings: list(binding, 32), exerciseMappings: list(mapping, 512), operations: list(operations, 768),
  selections: list(selection, 768), issues: list(diagnostic, 8192), omittedData: list(omitted, 34),
  preview, readiness: choice('ready_for_review', 'requires_decisions', 'blocked'),
});
export type MezfitImportPlanV1 = Value<typeof planRule>;
