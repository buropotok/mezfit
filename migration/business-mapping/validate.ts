import { isSourceImportPackage } from '../worker/processor/source-package/validate';
import type {
  BuildMezfitImportPlanInput, MezfitImportPlanV1, ImportOperation, IssueCode,
} from './types';

type Rule = (value: unknown) => boolean;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) !== null
    && Object.getPrototypeOf(value) !== undefined
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const exact = (value: unknown, fields: Record<string, Rule>): value is Record<string, unknown> =>
  record(value) && Object.keys(value).length === Object.keys(fields).length
  && Object.entries(fields).every(([key, rule]) => Object.hasOwn(value, key) && rule(value[key]));
const str = (limit = 128): Rule => value => typeof value === 'string' && value.length > 0 && value.length <= limit;
const name: Rule = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 120;
const nullable = (rule: Rule): Rule => value => value === null || rule(value);
const list = (rule: Rule, max = 512): Rule => value => Array.isArray(value) && value.length <= max && value.every(rule);
const one = (...choices: readonly unknown[]): Rule => value => choices.includes(value);
const nat: Rule = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const finite: Rule = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const sha: Rule = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const key = str(256);
const instant: Rule = value => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
const date: Rule = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const zone: Rule = value => {
  if (typeof value !== 'string' || value.length > 128) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; }
  catch { return false; }
};
const tracking = one('weight_reps', 'time', 'time_distance', 'time_reps', 'time_weight');
const ISSUE_CODES: readonly IssueCode[] = [
  'UNKNOWN_BUSINESS_DATE', 'UNKNOWN_SOURCE_TIMEZONE', 'MISSING_SOURCE_REFERENCE',
  'UNRESOLVED_SUBJECT', 'UNKNOWN_PROGRAM_RELATION', 'ACTIVE_PROGRAM_CONFLICT',
  'UNKNOWN_COMPLETION', 'SCHEDULE_LINK_UNCERTAIN', 'SCHEDULE_END_UNKNOWN',
  'MISSING_EXERCISE', 'UNRESOLVED_EXERCISE', 'UNKNOWN_TRACKING',
  'UNSUPPORTED_UNIT', 'TRACKING_METRICS_CONFLICT', 'UNSUPPORTED_SET_METADATA',
  'UNSUPPORTED_SOURCE_ATTRIBUTES', 'SOURCE_PROGRAM_NUMERIC_PRESCRIPTION',
  'AMBIGUOUS_LAST_SESSION', 'NO_COMPLETED_SESSION', 'TIME_INFERRED',
  'TIME_COLLISION', 'TIME_SLOT_EXHAUSTED', 'TIME_DURATION_UNKNOWN',
  'INVALID_DEPENDENCY', 'BLOCKED_DEPENDENCY', 'UNKNOWN_PLAN',
  'UNSUPPORTED_FACT_STATUS', 'OMITTED_MEASURES',
];
const issueCode = one(...ISSUE_CODES);
const codes = list(issueCode);
const choiceRef: Rule = v => exact(v, { state: one('none', 'unknown') })
  || exact(v, { state: one('linked'), sourceKey: str(128) });
const attribute: Rule = v => exact(v, { kind: one('null'), name: str(128), value: one(null) })
  || exact(v, { kind: one('boolean'), name: str(128), value: one(true, false) })
  || exact(v, { kind: one('string'), name: str(128), value: value => typeof value === 'string' && value.length <= 1000 })
  || exact(v, { kind: one('number'), name: str(128), value: value => typeof value === 'number' && Number.isFinite(value), unit: nullable(str(128)) });
const converted: Rule = v => exact(v, {
  value: finite, unit: one('kg', 's', 'm'), originalValue: finite, originalUnit: str(128), precision: nat,
});
const metrics: Rule = v => exact(v, {
  reps: nullable(nat), weight: nullable(converted), duration: nullable(converted), distance: nullable(converted),
});
const rawMetrics: Rule = v => exact(v, {
  reps: nullable(nat),
  weight: nullable(w => exact(w, { value: finite, unit: nullable(str(128)) })),
  duration: nullable(w => exact(w, { value: finite, unit: nullable(str(128)) })),
  distance: nullable(w => exact(w, { value: finite, unit: nullable(str(128)) })),
});
const plannedSet: Rule = v => exact(v, {
  sourceKey: str(128), position: nat, sourceProgramSetRef: choiceRef, sourceSetType: nullable(str(1000)), sourceMetrics: rawMetrics, metrics,
});
const plannedExercise: Rule = v => exact(v, {
  sourceKey: str(128), position: nat, exerciseMappingKey: key, sourceProgramExerciseRef: choiceRef,
  sets: list(plannedSet, 32),
});
const plan: Rule = v => exact(v, { state: one('absent', 'unknown') })
  || exact(v, { state: one('present'), exercises: list(plannedExercise, 32) });
const programSet: Rule = v => exact(v, {
  sourceKey: str(128), position: nat, setType: nullable(str(1000)), setLabel: nullable(str(1000)),
  comment: nullable(value => typeof value === 'string' && value.length <= 1000), sourceAttributes: list(attribute, 16),
});
const programExercise: Rule = v => exact(v, {
  sourceKey: str(128), position: nat, exerciseMappingKey: key,
  notes: nullable(value => typeof value === 'string' && value.length <= 1000), sets: list(programSet, 32),
});
const programDay: Rule = v => exact(v, {
  sourceKey: str(128), position: nat, phaseRef: choiceRef,
  name: nullable(value => typeof value === 'string' && value.length <= 1000),
  exercises: list(programExercise, 32),
});
const program: Rule = v => exact(v, {
  sourceProgramKey: nullable(str(128)), syntheticFromSessionKey: nullable(str(128)),
  name: nullable(value => typeof value === 'string' && value.length <= 1000),
  phases: list(w => exact(w, { sourceKey: str(128), name: nullable(value => typeof value === 'string' && value.length <= 1000), position: nat }), 32),
  days: list(programDay, 32), intendedStatus: one('active'),
});
const factSet: Rule = v => exact(v, {
  sourceKey: str(128), position: nat, planSetRef: choiceRef, sourceSetType: nullable(str(1000)),
  sourceSetLabel: nullable(str(1000)), sourceMetrics: rawMetrics, metrics, setStatus: one('pending', 'completed', 'skipped', 'unknown'),
  rpe: nullable(finite), comment: nullable(value => typeof value === 'string' && value.length <= 1000),
  sourceAttributes: list(attribute, 16),
});
const factExercise: Rule = v => exact(v, {
  sourceKey: str(128), position: nat, exerciseMappingKey: key,
  notes: nullable(value => typeof value === 'string' && value.length <= 1000), sets: list(factSet, 32),
});
const sourceTiming: Rule = v => exact(v, {
  localDate: nullable(date), startedAtUtc: nullable(instant), completedAtUtc: nullable(instant),
  timeZone: nullable(zone), precision: one('instant', 'minute', 'date', 'unknown'),
});
const timing: Rule = v => exact(v, {
  source: sourceTiming, proposedStartsAtUtc: nullable(instant), proposedEndsAtUtc: nullable(instant),
  importTimeInferred: one(true, false),
  missed: one('missed', 'not_missed', 'undetermined', 'not_applicable'),
});
const operationBase: Record<string, Rule> = {
  operationKey: key, targetBindingRef: key,
  sourceRefs: list(v => exact(v, { kind: one('session', 'scheduledWorkout', 'program', 'exercise'), sourceKey: str(128) }), 128),
  dependencyKeys: list(key), state: one('selected', 'blocked', 'excluded_by_coach', 'already_imported'),
  reasonCodes: codes, evidence: v => exact(v, { sourcePackageSha256: sha, datasetKey: key }),
  losses: codes,
};
const operationShape: Rule = v => {
  if (!record(v) || !Object.hasOwn(v, 'kind')) return false;
  if (v.kind === 'program') return exact(v, { ...operationBase, kind: one('program'), program });
  if (v.kind === 'historical_session') return exact(v, { ...operationBase,
    kind: one('historical_session'), name: nullable(value => typeof value === 'string' && value.length <= 1000),
    completionState: one('completed', 'in_progress', 'unknown'),
    programRef: choiceRef, scheduledWorkoutRef: choiceRef, timing, frozenPlan: plan, fact: list(factExercise, 32),
    importedProvenance: one(true) });
  if (v.kind === 'standalone_scheduled') return exact(v, { ...operationBase,
    kind: one('standalone_scheduled'), name: nullable(value => typeof value === 'string' && value.length <= 1000),
    programRef: choiceRef, programDayRef: choiceRef, timing, plan });
  if (v.kind === 'proposed_custom_exercise') return exact(v, { ...operationBase, kind: one('proposed_custom_exercise'),
    exerciseIdentityKey: key, sourceName: name, trackingType: tracking, requiresReconciliation: one(true), targetScope: one('coach') });
  if (v.kind === 'provenance_metadata') return exact(v, { ...operationBase, kind: one('provenance_metadata'),
    forOperationKey: key, marker: one('imported') });
  return false;
};
const binding: Rule = v => exact(v, { key, sourceSubjectKey: str(128), kind: one('existing_client'), targetClientId: key })
  || exact(v, { key, sourceSubjectKey: str(128), kind: one('provisional_imported_client'), provisionalKey: key })
  || exact(v, { key, sourceSubjectKey: str(128), kind: one('unresolved') });
const exerciseMapping: Rule = v => exact(v, {
  identityKey: key, sourceExerciseKey: str(128), sourceSubjectKey: str(128), kind: one('catalog_match'),
  catalogueExerciseId: key, trackingType: tracking, matchEvidence: one('reviewed_registry', 'exact_unique'),
}) || exact(v, {
  identityKey: key, sourceExerciseKey: str(128), sourceSubjectKey: str(128), kind: one('proposed_custom'),
  operationKey: key, trackingType: tracking, requiresReconciliation: one(true),
}) || exact(v, {
  identityKey: key, sourceExerciseKey: str(128), sourceSubjectKey: nullable(str(128)), kind: one('blocked'), reason: issueCode,
});
const issue: Rule = v => exact(v, {
  code: issueCode, severity: one('info', 'warning', 'error'), entityKind: one('source', 'program', 'session', 'scheduledWorkout', 'customExercise', 'provenance'),
  sourceKey: nullable(str(128)), operationKey: nullable(key),
});
const sourceCounts: Rule = v => exact(v, { sessions: nat, scheduledWorkouts: nat, programs: nat, exercises: nat });
const preview: Rule = v => exact(v, {
  source: sourceCounts, selected: selectedCounts, outsidePeriod: outsideCounts,
  linkedScheduledSuppressed: nat, blocked: nat, excludedByCoach: nat, alreadyImported: nat,
  catalogMatched: nat, proposedCustomExercises: nat, convertedSets: nat, incompleteSessions: nat,
  omittedMeasures: nat,
  issuesByCode: list(w => exact(w, { code: issueCode, count: nat })),
});

/** Deny hostile snapshots before the field validators descend. */
function withinLimits(value: unknown, maxBytes = 4 * 1024 * 1024): boolean {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  const seen = new Set<object>();
  let nodes = 0;
  let size = 0;
  while (stack.length) {
    const next = stack.pop();
    if (!next || ++nodes > 10000 || next.depth > 24) return false;
    const v = next.value;
    if (typeof v === 'string') size += v.length * 4;
    if (v !== null && typeof v === 'object') {
      if (seen.has(v)) return false;
      seen.add(v);
      const values = Array.isArray(v) ? v : Object.values(v);
      if (values.length > (Array.isArray(v) ? 1024 : 48)) return false;
      size += values.length * 32;
      for (const child of values) stack.push({ value: child, depth: next.depth + 1 });
    } else { size += 16; }
    if (size > maxBytes) return false;
  }
  return true;
}
const periodShape: Rule = v => exact(v, { fromDate: date, throughDate: date, selectionTimeZone: zone });
const contextShape: Rule = v => exact(v, {
  datasetKey: key,
  bindings: list(w => exact(w, { sourceSubjectKey: str(128), kind: one('existing_client'), targetClientId: key })
    || exact(w, { sourceSubjectKey: str(128), kind: one('provisional_imported_client'), provisionalKey: key })
    || exact(w, { sourceSubjectKey: str(128), kind: one('unresolved') })),
  activeProgramSubjectKeys: list(str(128)),
});
const catalogueShape: Rule = v => exact(v, {
  completeness: one('complete', 'partial', 'unknown'),
  entries: list(w => exact(w, { id: key, scope: one('public', 'coach'), name,
    equipment: nullable(str(128)), trackingType: tracking })),
});
const mappingShape: Rule = v => exact(v, {
  entries: list(w => exact(w, { identityKey: key, catalogueExerciseId: key })),
});
const occupancyShape: Rule = v => exact(v, {
  intervals: list(w => exact(w, { startsAtUtc: instant, endsAtUtc: instant })
    && record(w) && Date.parse(String(w.startsAtUtc)) < Date.parse(String(w.endsAtUtc))),
});
const importsShape: Rule = v => exact(v, { identities: list(key, 2048) });
const selectionsShape: Rule = v => exact(v, {
  exclusions: list(w => exact(w, { kind: one('session', 'scheduledWorkout', 'program'), sourceKey: str(128) })),
});
const unique = (list: readonly string[]): boolean => new Set(list).size === list.length;

export function isBuildMezfitImportPlanInput(value: unknown): value is BuildMezfitImportPlanInput {
  if (!withinLimits(value) || !exact(value, {
    sourcePackage: isSourceImportPackage,
    period: periodShape, evaluatedAtUtc: instant, policyVersion: str(64),
    targetContextSnapshot: contextShape, catalogueSnapshot: catalogueShape,
    mappingSnapshot: mappingShape, calendarOccupancySnapshot: occupancyShape,
    existingImportsSnapshot: importsShape, selectionSnapshot: selectionsShape,
  })) return false;
  const input = value as unknown as BuildMezfitImportPlanInput;
  const { bindings, activeProgramSubjectKeys } = input.targetContextSnapshot;
  if (input.period.fromDate > input.period.throughDate
    || !unique(bindings.map(b => b.sourceSubjectKey))
    || !unique(activeProgramSubjectKeys)
    || !unique(input.catalogueSnapshot.entries.map(e => e.id))
    || !unique(input.mappingSnapshot.entries.map(e => e.identityKey))
    || !unique(input.existingImportsSnapshot.identities)
    || !unique(input.selectionSnapshot.exclusions.map(e => e.kind + '\u0000' + e.sourceKey))) return false;
  const subjects = new Set(input.sourcePackage.subjects.map(s => s.sourceKey));
  return bindings.every(b => subjects.has(b.sourceSubjectKey))
    && activeProgramSubjectKeys.every(k => subjects.has(k));
}

export function isMezfitImportPlan(value: unknown): value is MezfitImportPlanV1 {
  if (!withinLimits(value) || !exact(value, {
    kind: one('mezfit.import-plan'), schemaVersion: one(1), planId: sha, policyVersion: str(64),
    source: v => exact(v, { packageSha256: sha, datasetKey: key, sourceApp: str(128),
      formatFamily: str(128), adapterId: str(128), adapterVersion: str(128), inputSha256: sha }),
    scope: v => exact(v, { fromDate: date, throughDate: date, selectionTimeZone: zone, evaluatedAtUtc: instant,
      selectedEntityTypes: w => Array.isArray(w) && w.length === 2 && w[0] === 'session' && w[1] === 'scheduledWorkout',
      programs: one('linked-only') }),
    inputs: v => exact(v, { catalogSnapshotHash: sha, targetSnapshotHash: sha,
      mappingSnapshotHash: sha, occupancySnapshotHash: sha,
      existingImportsSnapshotHash: sha, selectionSnapshotHash: sha }),
    targetBindings: list(binding), exerciseMappings: list(exerciseMapping, 2048),
    operations: list(operationShape, 2048),
    selections: list(v => exact(v, { groupKey: key, operationKeys: list(key),
      state: one('selected', 'blocked', 'excluded_by_coach', 'already_imported'),
      reasonCodes: codes, dependencyClosure: list(key) }), 2048),
    issues: list(issue, 2048),
    omittedData: list(v => exact(v, { category: str(128), reason: one('unsupported_target', 'unreadable', 'not_in_export'),
      count: nullable(nat) })),
    preview, readiness: one('ready_for_review', 'requires_decisions', 'blocked'),
  })) return false;
  const plan = value as unknown as MezfitImportPlanV1;
  const operations = new Map(plan.operations.map(o => [o.operationKey, o]));
  if (plan.issues.some(i => i.operationKey !== null && !operations.has(i.operationKey))) return false;
  const bindings = new Set(plan.targetBindings.map(b => b.key));
  const mappings = new Map(plan.exerciseMappings.map(m => [m.identityKey, m]));
  if (operations.size !== plan.operations.length || bindings.size !== plan.targetBindings.length
    || mappings.size !== plan.exerciseMappings.length
    || !unique(plan.selections.map(s => s.groupKey))) return false;
  const refs = (o: ImportOperation): string[] => {
    if (o.kind === 'program') return o.program.days.flatMap(day => day.exercises.map(ex => ex.exerciseMappingKey));
    if (o.kind === 'historical_session') return [
      ...o.fact.map(ex => ex.exerciseMappingKey),
      ...(o.frozenPlan.state === 'present' ? o.frozenPlan.exercises.map(ex => ex.exerciseMappingKey) : []),
    ];
    if (o.kind === 'standalone_scheduled') return o.plan.state === 'present'
      ? o.plan.exercises.map(ex => ex.exerciseMappingKey) : [];
    return [];
  };
  const hasDistinctPositions = (rows: readonly { position: number; sourceKey: string }[]): boolean =>
    unique(rows.map(row => String(row.position))) && unique(rows.map(row => row.sourceKey));
  const named = (value: string | null): boolean => typeof value === 'string' && value.trim().length > 0;
  function nestedStructure(o: ImportOperation): boolean {
    if (o.kind === 'program') {
      const p = o.program;
      if (!hasDistinctPositions(p.phases) || !hasDistinctPositions(p.days)) return false;
      if (o.state === 'selected' && (!named(p.name) || !p.phases.length
        || p.phases.some(phase => !named(phase.name))
        || p.days.some(day => !named(day.name)
          || day.phaseRef.state !== 'linked'
          || !p.phases.some(phase => phase.sourceKey === day.phaseRef.sourceKey)))) return false;
      return p.days.every(day => hasDistinctPositions(day.exercises)
        && day.exercises.every(ex => hasDistinctPositions(ex.sets)));
    }
    if (o.kind === 'historical_session' || o.kind === 'standalone_scheduled') {
      if (o.state === 'selected' && (!named(o.name)
        || !o.timing.proposedStartsAtUtc)) return false;
      const frozen = o.kind === 'historical_session' ? o.frozenPlan : o.plan;
      if (frozen.state === 'present' && (!hasDistinctPositions(frozen.exercises)
        || !frozen.exercises.every(ex => hasDistinctPositions(ex.sets)))) return false;
      return o.kind !== 'historical_session' || (hasDistinctPositions(o.fact)
        && o.fact.every(ex => hasDistinctPositions(ex.sets)));
    }
    return true;
  }
  for (const o of plan.operations) {
    if (!nestedStructure(o)
      || o.state === 'selected' && o.targetBindingRef === 'source-only'
      || o.state === 'selected' && refs(o).some(k => mappings.get(k)?.kind === 'blocked')
      || (!bindings.has(o.targetBindingRef) && o.targetBindingRef !== 'source-only')
      || o.dependencyKeys.includes(o.operationKey)
      || !unique(o.dependencyKeys)
      || !o.dependencyKeys.every(k => operations.has(k))
      || (o.state === 'selected' && o.dependencyKeys.some(k =>
        operations.get(k)?.state !== 'selected' && operations.get(k)?.state !== 'already_imported'))
      || !refs(o).every(k => mappings.has(k))
      || (o.kind === 'proposed_custom_exercise' && !mappings.has(o.exerciseIdentityKey))
      || (o.kind === 'provenance_metadata' &&
        (operations.get(o.forOperationKey)?.kind !== 'historical_session'
          || !o.dependencyKeys.includes(o.forOperationKey)))) return false;
  }
  for (const m of plan.exerciseMappings) {
    if (m.kind === 'proposed_custom' && (!operations.has(m.operationKey)
      || operations.get(m.operationKey)?.kind !== 'proposed_custom_exercise')) return false;
  }
  for (const s of plan.selections) {
    if (!s.operationKeys.length || !s.operationKeys.every(k => operations.has(k))
      || !s.dependencyClosure.every(k => operations.has(k))) return false;
    for (const k of s.operationKeys) if (operations.get(k)?.state !== s.state) return false;
  }
  const visiting = new Set<string>();
  const done = new Set<string>();
  function visit(k: string): boolean {
    if (done.has(k)) return true;
    if (visiting.has(k)) return false;
    visiting.add(k);
    for (const d of operations.get(k)?.dependencyKeys ?? []) if (!visit(d)) return false;
    visiting.delete(k);
    done.add(k);
    return true;
  }
  if (!plan.operations.every(o => visit(o.operationKey))) return false;
  const selectedKeys = plan.selections.flatMap(s => s.operationKeys);
  if (!unique(selectedKeys) || selectedKeys.length !== plan.operations.length) return false;
  function closure(key: string, seen = new Set<string>()): string[] {
    for (const dep of operations.get(key)?.dependencyKeys ?? []) if (!seen.has(dep)) {
      seen.add(dep);
      closure(dep, seen);
    }
    return [...seen].sort();
  }
  return plan.selections.every(s => {
    const expected = new Set(s.operationKeys.flatMap(k => closure(k)));
    return unique(s.dependencyClosure)
      && s.dependencyClosure.length === expected.size
      && s.dependencyClosure.every(k => expected.has(k));
  });
}

/** Keep diagnostics free of sensitive payloads at untrusted boundaries. */
export function assertBuildInput(value: unknown): asserts value is BuildMezfitImportPlanInput {
  if (!isBuildMezfitImportPlanInput(value)) throw new Error('IMPORT_PLAN_INVALID_INPUT');
}
export function assertPlan(value: unknown): asserts value is MezfitImportPlanV1 {
  if (!isMezfitImportPlan(value)) throw new Error('IMPORT_PLAN_INVALID_OUTPUT');
}
