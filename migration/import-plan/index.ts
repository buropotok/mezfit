import { isSetType } from '../../shared/set-type';
import { isSourceImportPackage } from '../worker/processor/source-package/validate';
import type { SourceAttribute, SourceImportPackageV1, SourcePlanPresence, SourceProgram, SourceSession } from '../worker/processor/source-package/types';
import { configRule, type ExerciseMapping, type ImportConfig, type ImportOperation, type ImportSelection,
  type IssueCode, type Loss, type MappedPlan, type MappingIssue, type MezfitImportPlanV1, type ProgramOperation,
  type SourceType, type TargetBinding } from './contracts';
import { exerciseMatcher } from './exercise-mapping';
import { mapMetrics } from './measures';
import { canonical, compare, hash, jsonSnapshot } from './schema';
import { byKey, isSession, lastCompleted, linked, ordered, sourceGraph } from './source-graph';
import { calendar, exactStart, type Interval } from './timing';
import { summarize, validateMezfitImportPlan } from './validate';
export { validateMezfitImportPlan } from './validate';
export type { ImportConfig, MezfitImportPlanV1 } from './contracts';

const byCanonical = (a: unknown, b: unknown) => compare(canonical(a), canonical(b));

function canonicalSource(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalSource).sort(byCanonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, canonicalSource(item)]));
  }
  return value;
}

function validSnapshots(config: ImportConfig, source: SourceImportPackageV1): boolean {
  const unique = <T>(values: T[]) => new Set(values).size === values.length;
  const targets = config.targetSnapshot ?? [];
  const catalogue = config.catalogueSnapshot ?? [];
  const mappings = config.mappingSnapshot ?? [];
  const subjects = byKey(source.subjects);
  return config.period.fromDate <= config.period.throughDate
    && unique(targets.map(row => row.subjectSourceKey)) && unique(targets.map(row => row.contextKey))
    && targets.every(row => subjects.has(row.subjectSourceKey))
    && unique(catalogue.map(row => row.id)) && unique(mappings.map(row => row.exerciseKey))
    && unique(config.existingImportsSnapshot ?? []) && unique(config.excludedGroups)
    && (config.occupancySnapshot ?? []).every(row => Date.parse(row.startsAtUtc) < Date.parse(row.endsAtUtc));
}

function attributeLosses(entityKey: string, attributes: SourceAttribute[], programSet = false): Loss[] {
  return [...attributes].sort((a, b) => compare(a.name, b.name)).map(attribute => ({ entityKey, attribute,
    code: programSet && attribute.kind === 'number' && attribute.name.startsWith('source_planned_')
      ? 'SOURCE_PROGRAM_NUMERIC_PRESCRIPTION' : 'SOURCE_ATTRIBUTE_OMITTED' }));
}

export async function buildMezfitImportPlan(sourceInput: unknown, configInput: unknown): Promise<MezfitImportPlanV1> {
  // Take a private snapshot before validation and before the first await.
  const pkg = jsonSnapshot(sourceInput, 65_536);
  if (!isSourceImportPackage(pkg)) throw new Error('MIG05_INVALID_SOURCE_PACKAGE');
  const config = jsonSnapshot(configInput, 4_194_304);
  if (!configRule(config) || !validSnapshots(config, pkg)) throw new Error('MIG05_INVALID_PLANNING_INPUT');
  const { sourceApp, formatFamily, formatVersion, adapterId, adapterVersion, inputSha256 } = pkg.provenance;
  const { datasetKey, existingImportsSnapshot } = config;
  const [packageSha256, snapshotEntries, excludedHash] = await Promise.all([
    hash(canonicalSource(pkg)),
    Promise.all((['catalogueSnapshot', 'targetSnapshot', 'mappingSnapshot', 'occupancySnapshot', 'existingImportsSnapshot'] as const)
      .map(async name => [name, config[name] === null ? null : await hash([...config[name]].sort(byCanonical))] as const)),
    hash([...config.excludedGroups].sort(compare)),
  ]);
  const snapshotHashes = new Map(snapshotEntries);
  const issues: MappingIssue[] = [];
  const operations = new Map<string, ImportOperation>();
  const selections = new Map<string, ImportSelection>();
  const exerciseMappings = new Map<string, ExerciseMapping>();
  const definitions = byKey(pkg.sourceExercises);
  const registered = config.mappingSnapshot?.map(row => [row.exerciseKey, row.catalogueId] as const);
  const match = exerciseMatcher(config.catalogueSnapshot, registered ? new Map(registered) : null);
  const replay = new Set(existingImportsSnapshot ?? []);
  const excluded = new Set(config.excludedGroups);
  const { workouts, programs } = sourceGraph(pkg, config.period);

  const bindings = new Map((config.targetSnapshot ?? []).map(row => [row.subjectSourceKey, row]));
  const assignedContexts = new Set((config.targetSnapshot ?? []).map(row => row.contextKey));
  for (const { sourceKey } of pkg.subjects) {
    if (bindings.has(sourceKey)) continue;
    // Use a separate namespace and explicitly check for a collision with a caller-supplied opaque key.
    const contextKey = 'unresolved-' + await hash([sourceApp, formatFamily, datasetKey, sourceKey]);
    if (assignedContexts.has(contextKey)) throw new Error('MIG05_INVALID_PLANNING_INPUT');
    bindings.set(sourceKey, { kind: 'unresolved', subjectSourceKey: sourceKey, contextKey });
  }
  const bindingFor = (key: string | null): TargetBinding | undefined => key === null ? undefined : bindings.get(key);
  const identity = (type: SourceType, sourceKey: string, subjectKey: string | null) =>
    hash(['mig05-key-v1', sourceApp, formatFamily, datasetKey, bindingFor(subjectKey)?.contextKey ?? null, subjectKey, type, sourceKey]);
  function report(code: IssueCode, groupRef: string | null, severity: MappingIssue['severity']) {
    if (!issues.some(item => item.code === code && item.groupRef === groupRef && item.severity === severity)) {
      issues.push({ code, groupRef, severity });
    }
  }

  if (snapshotEntries.some(([, sha]) => sha === null)) report('SNAPSHOT_UNRESOLVED', null, 'warning');
  for (const issue of pkg.issues) {
    // The source package stays private and can be looked up by its digest. Never
    // include unscoped source identifiers in operational diagnostics.
    report('SOURCE_DIAGNOSTIC', null, issue.severity === 'info' ? 'info' : 'warning');
  }

  function createGroup(operationKey: string, type: SourceType, sourceKey: string, subjectSourceKey: string | null) {
    const reasons = new Set<IssueCode>();
    const dependencies = new Set<string>();
    const losses: Loss[] = [];
    const origin = { type, sourceKey, subjectSourceKey };
    const targetBindingRef = bindingFor(subjectSourceKey)?.contextKey ?? '';
    const flag = (code: IssueCode, severity: MappingIssue['severity'] = 'error') => {
      if (severity === 'error') reasons.add(code);
      report(code, operationKey, severity);
    };
    const addLosses = (rows: Loss[]) => {
      losses.push(...rows);
      for (const row of rows) flag(row.code, 'warning');
    };
    const save = (status: ImportSelection['status'], reason?: IssueCode) => {
      if (reason) reasons.add(reason);
      selections.set(operationKey, { groupKey: operationKey, origin, status, reasons: [...reasons].sort(compare),
        dependencyKeys: [...dependencies].sort(compare) });
    };
    const isBlocked = () => reasons.size > 0;
    const common = () => ({ operationKey, origin, targetBindingRef, dependencyKeys: [...dependencies].sort(compare),
      validation: isBlocked() ? 'blocked' as const : 'ready' as const, losses });
    const finish = (operation: ImportOperation) => {
      operations.set(operationKey, operation);
      save(operation.validation === 'ready' ? 'selected' : 'blocked');
    };
    const skip = () => {
      if (excluded.has(operationKey)) { save('excluded_by_coach', 'EXCLUDED_BY_COACH'); return true; }
      if (replay.has(operationKey)) { save('already_imported', 'ALREADY_IMPORTED'); return true; }
      return false;
    };
    const checkTarget = () => {
      const target = bindingFor(subjectSourceKey);
      if (!target || target.kind === 'unresolved') flag('UNRESOLVED_SUBJECT');
      if (existingImportsSnapshot === null) flag('SNAPSHOT_UNRESOLVED');
    };
    return { flag, finish, addLosses, common, save, skip, checkTarget, dependencies, isBlocked };
  }
  type Group = ReturnType<typeof createGroup>;

  async function mapExercise(sourceKey: string, subject: string, group: Group) {
    const key = await identity('exercise', sourceKey, subject);
    let mapping = exerciseMappings.get(key);
    if (!mapping) {
      const definition = definitions.get(sourceKey);
      mapping = match({ mappingKey: key, subjectKey: subject, exerciseSourceKey: sourceKey }, definition,
        code => report(code, key, 'info'));
      exerciseMappings.set(key, mapping);
      const customGroup = createGroup(key, 'exercise', sourceKey, subject);
      if (mapping.kind === 'proposed_custom' && !customGroup.skip()) {
        customGroup.checkTarget();
        customGroup.addLosses(attributeLosses(sourceKey, definition?.sourceAttributes ?? []));
        customGroup.finish({ ...customGroup.common(), kind: 'custom_exercise', mappingRef: key, definition: mapping.definition });
      }
      if (mapping.kind !== 'proposed_custom') {
        if (definition?.sourceAttributes.length) {
          group.addLosses(attributeLosses(sourceKey, definition.sourceAttributes));
        }
      }
    }
    if (mapping.kind === 'unresolved') group.flag(mapping.reason);
    if (mapping.kind === 'proposed_custom') {
      group.dependencies.add(key);
      const status = selections.get(key)?.status;
      if (status !== 'selected' && status !== 'already_imported') group.flag('DEPENDENCY_BLOCKED');
    }
    const tracking = mapping.kind === 'catalogue' ? mapping.target.trackingType
      : mapping.kind === 'proposed_custom' ? mapping.definition.trackingType : null;
    return { mappingRef: key, tracking };
  }

  function checkRef(ref: { state: string; sourceKey?: string }, allowed: ReadonlySet<string>, group: Group) {
    if (ref.state === 'linked' && (ref.sourceKey === undefined || !allowed.has(ref.sourceKey))) group.flag('UNRESOLVED_SOURCE_LINK');
  }

  function checkSetMetadata(set: { sourceKey: string; sourceSetType: string | null; sourceSetLabel?: string | null }, group: Group) {
    const { sourceKey, sourceSetType, sourceSetLabel } = set;
    if (sourceSetType !== null && !isSetType(sourceSetType)) {
      group.addLosses([{ entityKey: sourceKey, code: 'UNSUPPORTED_SET_METADATA', attribute: null }]);
    }
    if (sourceSetLabel != null && !['warmup', 'easy', 'normal', 'hard', 'drop'].includes(sourceSetLabel)) {
      group.addLosses([{ entityKey: sourceKey, code: 'UNSUPPORTED_SET_METADATA', attribute: null }]);
    }
  }

  async function mapPlan(plan: SourcePlanPresence, subject: string, group: Group, program: SourceProgram | undefined,
    day: string | null): Promise<MappedPlan> {
    if (plan.state !== 'present') return { state: plan.state };
    const structure = byKey((program?.days ?? []).filter(row => day === null || row.sourceKey === day).flatMap(row => row.exercises));
    const exercises: Extract<MappedPlan, { state: 'present' }>['exercises'] = [];
    for (const exercise of ordered(plan.exercises)) {
      const { mappingRef, tracking } = await mapExercise(exercise.exerciseSourceKey, subject, group);
      const ref = linked(exercise.sourceProgramExerciseRef);
      checkRef(exercise.sourceProgramExerciseRef, new Set(structure.keys()), group);
      const parents = ref ? structure.get(ref)?.sets ?? [] : [...structure.values()]
        .filter(row => row.exerciseSourceKey === exercise.exerciseSourceKey).flatMap(row => row.sets);
      const validSets = new Set(parents.map(set => set.sourceKey));
      const sets = ordered(exercise.sets).map(set => {
        checkRef(set.sourceProgramSetRef, validSets, group);
        checkSetMetadata(set, group);
        return { ...set, metrics: mapMetrics(set.metrics, tracking, group.flag) };
      });
      exercises.push({ ...exercise, mappingRef, sets });
    }
    return { state: 'present', exercises };
  }

  async function makeProgram(source: SourceProgram, subject: string, synthetic: boolean, fallback?: IssueCode) {
    const type = synthetic ? 'defaultProgram' : 'program';
    const key = await identity(type, source.sourceKey, subject);
    if (selections.has(key)) return key;
    const group = createGroup(key, type, source.sourceKey, subject);
    if (group.skip()) return key;
    group.checkTarget();
    if (fallback) group.flag(fallback);
    if (!synthetic && linked(source.subjectRef) !== subject) group.flag('UNRESOLVED_SUBJECT');
    const target = bindingFor(subject);
    if (target?.kind === 'existing_client' && target.activeProgram !== 'absent') group.flag('ACTIVE_PROGRAM_CONFLICT');
    group.addLosses(attributeLosses(source.sourceKey, source.sourceAttributes));
    const phases = ordered(source.phases).map(phase => {
      group.addLosses(attributeLosses(phase.sourceKey, phase.sourceAttributes));
      const { sourceKey, position, name } = phase;
      return { sourceKey, position, name };
    });
    const phaseKeys = new Set(phases.map(row => row.sourceKey));
    const days: ProgramOperation['days'] = [];
    for (const day of ordered(source.days)) {
      const { sourceKey, position, name, phaseRef } = day;
      group.addLosses(attributeLosses(sourceKey, day.sourceAttributes));
      checkRef(phaseRef, phaseKeys, group);
      if (phaseRef.state === 'unknown') group.flag('UNRESOLVED_SOURCE_LINK');
      const exercises: ProgramOperation['days'][number]['exercises'] = [];
      for (const exercise of ordered(day.exercises)) {
        const { sourceKey, position, notes, exerciseSourceKey } = exercise;
        const { mappingRef } = await mapExercise(exerciseSourceKey, subject, group);
        group.addLosses(attributeLosses(sourceKey, exercise.sourceAttributes));
        const sets = ordered(exercise.sets).map(set => {
          const { sourceAttributes, ...structure } = set;
          group.addLosses(attributeLosses(set.sourceKey, sourceAttributes, true));
          checkSetMetadata(set, group);
          return structure;
        });
        exercises.push({ sourceKey, position, notes, exerciseSourceKey, mappingRef, sets });
      }
      days.push({ sourceKey, position, name, phaseRef, exercises });
    }
    group.finish({ ...group.common(), kind: 'program_structure', name: source.name,
      activation: synthetic ? 'proposed_active' : 'undecided', phases, days });
    return key;
  }

  const known: Interval[] = [];
  const knownStarts: number[] = [];
  for (const item of workouts) {
    if (item.outside || item.suppressed) continue;
    const start = exactStart(item.row.timing);
    if (start === null) continue;
    const end = isSession(item.row) && item.row.timing.completedAtUtc && Date.parse(item.row.timing.completedAtUtc);
    if (typeof end === 'number' && start < end) known.push([start, end]);
    else knownStarts.push(start);
  }
  const allocate = calendar(config.occupancySnapshot, known, knownStarts);
  for (const item of workouts) {
    const { row, subjectKey, programKey, dayRef } = item;
    const type = isSession(row) ? 'session' : 'scheduledWorkout';
    const key = await identity(type, row.sourceKey, subjectKey);
    const group = createGroup(key, type, row.sourceKey, subjectKey);
    if (item.outside) { group.save('outside_period', 'OUTSIDE_PERIOD'); continue; }
    if (item.suppressed) { group.save('represented_by_session', 'REPRESENTED_BY_SESSION'); continue; }
    if (group.skip()) continue;
    for (const problem of item.problems) group.flag(problem);
    group.checkTarget();
    if (!subjectKey || !bindings.has(subjectKey)) {
      group.save('blocked');
      continue;
    }

    group.addLosses(attributeLosses(row.sourceKey, row.sourceAttributes));
    const program = programKey ? programs.get(programKey) : undefined;
    let programOperationRef: string | null = null;
    if (program && linked(program.subjectRef) === subjectKey && item.date !== null
      && !item.problems.includes('CONFLICTING_PROGRAM_LINK')) {
      programOperationRef = await makeProgram(program, subjectKey, false);
      group.dependencies.add(programOperationRef);
      const status = selections.get(programOperationRef)?.status;
      if (status !== 'selected' && status !== 'already_imported') group.flag('DEPENDENCY_BLOCKED');
    }
    const plan = await mapPlan(isSession(row) ? row.frozenPlan : row.plan, subjectKey, group, program, linked(dayRef));
    const programFields = { programRef: row.programRef, programDayRef: dayRef, programOperationRef };
    const resolveTiming = () => {
      if (!item.date) return null;
      const { timing, issue } = allocate(row.timing, item.date, !group.isBlocked());
      if (issue) group.flag(issue);
      return timing;
    };

    if (isSession(row)) {
      if (plan.state === 'unknown') group.flag('UNKNOWN_FROZEN_PLAN', 'warning');
      const planSets = new Set(plan.state === 'present' ? plan.exercises.flatMap(exercise => exercise.sets.map(set => set.sourceKey)) : []);
      const fact: Extract<ImportOperation, { kind: 'historical_session' }>['fact'] = [];
      for (const exercise of ordered(row.performedExercises)) {
        const { mappingRef, tracking } = await mapExercise(exercise.exerciseSourceKey, subjectKey, group);
        const sets = ordered(exercise.sets).map(({ sourceAttributes, ...set }) => {
          group.addLosses(attributeLosses(set.sourceKey, sourceAttributes));
          checkRef(set.planSetRef, planSets, group);
          checkSetMetadata(set, group);
          if (set.setStatus === 'unknown' || set.rpe !== null && (!Number.isInteger(set.rpe) || set.rpe < 1)) group.flag('UNSUPPORTED_FACT');
          return { ...set, metrics: mapMetrics(set.metrics, tracking, group.flag) };
        });
        fact.push({ ...exercise, mappingRef, sets });
      }
      const timing = resolveTiming();
      group.finish({ ...group.common(), kind: 'historical_session', name: row.name, ...programFields,
        timing, occurrenceRef: row.scheduledWorkoutRef, lifecycle: row.completionState, imported: true, frozenPlan: plan, fact });
    } else {
      if (plan.state === 'unknown') group.flag('UNKNOWN_SCHEDULE_PLAN');
      group.flag('UNKNOWN_SCHEDULE_END', 'warning');
      const timing = resolveTiming();
      group.finish({ ...group.common(), kind: 'standalone_scheduled', name: row.name, ...programFields,
        timing, plan, endsAtUtc: null, missed: 'undetermined' });
    }
  }

  for (const subject of pkg.subjects.map(row => row.sourceKey).sort(compare)) {
    const inScope = workouts.filter(row => row.subjectKey === subject && !row.outside && !row.suppressed);
    if (!inScope.length || inScope.some(row => row.programKey !== null)) continue;
    const candidates = [...selections.values()].filter(row => row.origin.subjectSourceKey === subject
      && (row.origin.type === 'session' || row.origin.type === 'scheduledWorkout'));
    if (!candidates.some(row => row.status === 'selected' || row.status === 'blocked')) continue;
    const evidenced = pkg.coverage.programs === 'complete' && inScope.every(row => row.noProgram)
      && !inScope.some(row => row.problems.includes('UNRESOLVED_SUBJECT'))
      && !workouts.some(row => row.subjectKey === null && !row.outside && !row.suppressed);
    const newest = evidenced ? lastCompleted(inScope) : null;
    const sourceKey = subject;
    const fallback = !evidenced ? 'PROGRAM_PRESENCE_UNKNOWN' : !newest ? 'LAST_SESSION_UNCERTAIN' : undefined;
    await makeProgram(defaultProgram(sourceKey, subject, newest), subject, true, fallback);
  }

  // Keep candidates for review, while avoiding selected dependency operations
  // when every consuming workout is blocked.
  function blockUnused(type: 'program' | 'exercise') {
    const used = new Set([...selections.values()].filter(row => row.status === 'selected')
      .flatMap(row => row.dependencyKeys));
    for (const [key, selection] of selections) {
      const operation = operations.get(key);
      if (selection.origin.type !== type || selection.status !== 'selected' || !operation || used.has(key)) continue;
      selections.set(key, { ...selection, status: 'blocked', reasons: ['NO_SELECTED_DEPENDENT'] });
      operations.set(key, { ...operation, validation: 'blocked' });
      report('NO_SELECTED_DEPENDENT', key, 'error');
    }
  }
  blockUnused('program');
  blockUnused('exercise');

  const omittedData = [...pkg.omittedData].sort(byCanonical);
  if (!omittedData.some(row => row.category === 'measures')) {
    omittedData.push({ category: 'measures', reason: pkg.coverage.measures === 'not_in_export' ? 'not_in_export' : 'unsupported_target',
      count: pkg.coverage.measures === 'not_in_export' ? 0 : null });
  }
  if (omittedData.some(row => row.category === 'measures' && row.count !== 0)) report('MEASURES_OMITTED', null, 'warning');
  const subjectAttributeCount = pkg.subjects.reduce((total, row) => total + row.sourceAttributes.length, 0);
  if (subjectAttributeCount) {
    omittedData.push({ category: 'subject_attributes', reason: 'unsupported_target', count: subjectAttributeCount });
    report('SOURCE_ATTRIBUTE_OMITTED', null, 'warning');
  }

  for (const group of [...selections.values()]) {
    if (group.status !== 'selected' || group.origin.type === 'exercise') continue;
    const metadataKey = await hash(['mig05-provenance-v1', group.groupKey]);
    const parent = operations.get(group.groupKey);
    if (parent) operations.set(metadataKey, { kind: 'provenance_metadata', operationKey: metadataKey,
      origin: parent.origin, targetBindingRef: parent.targetBindingRef, dependencyKeys: [parent.operationKey],
      validation: 'ready', losses: [], imported: true });
  }

  // Unresolved bindings for unknown subjects have no verified source identity;
  // their workouts are listed as blocked selections without operations.
  const result = {
    kind: 'mezfit.import-plan' as const, schemaVersion: 1 as const, policyVersion: config.policyVersion,
    source: { packageSha256, datasetKey, sourceApp, formatFamily, formatVersion, adapterId, adapterVersion, inputSha256,
      programCount: pkg.programs.length },
    scope: { ...config.period, evaluatedAtUtc: new Date(config.evaluatedAtUtc).toISOString(), programs: 'linked-only' as const,
      selectedEntityTypes: { session: true as const, scheduledWorkout: true as const } },
    inputs: { catalogueSnapshot: snapshotHashes.get('catalogueSnapshot') ?? null,
      targetSnapshot: snapshotHashes.get('targetSnapshot') ?? null, mappingSnapshot: snapshotHashes.get('mappingSnapshot') ?? null,
      occupancySnapshot: snapshotHashes.get('occupancySnapshot') ?? null, existingImportsSnapshot: snapshotHashes.get('existingImportsSnapshot') ?? null,
      excludedGroups: excludedHash },
    targetBindings: [...bindings.values()].sort((a, b) => compare(a.subjectSourceKey, b.subjectSourceKey)),
    exerciseMappings: [...exerciseMappings.values()].sort(byCanonical),
    operations: [...operations.values()].sort((a, b) => compare(a.operationKey, b.operationKey)),
    selections: [...selections.values()].sort((a, b) => compare(a.groupKey, b.groupKey)),
    issues: issues.sort(byCanonical), omittedData,
  };
  const body = { ...result, ...summarize(result) };
  const plan = { ...body, planId: await hash(body) };
  if (!await validateMezfitImportPlan(plan)) throw new Error('MIG05_INVALID_GENERATED_PLAN');
  return plan;
}

function defaultProgram(sourceKey: string, subject: string, session: SourceSession | null): SourceProgram {
  const phase = { sourceKey: 'default-phase', name: null, position: 0, sourceAttributes: [] };
  return { sourceKey, subjectRef: { state: 'linked', sourceKey: subject }, name: 'Моя программа', sourceAttributes: [],
    phases: session ? [phase] : [],
    days: session ? [{ sourceKey: session.sourceKey, phaseRef: { state: 'linked', sourceKey: phase.sourceKey },
      name: session.name, position: 0, sourceAttributes: [],
      exercises: session.performedExercises.map(exercise => ({ ...exercise, sourceAttributes: [],
        sets: exercise.sets.map(({ sourceKey, position, sourceSetType, sourceSetLabel, comment }) =>
          ({ sourceKey, position, sourceSetType, sourceSetLabel, comment, sourceAttributes: [] })) })) }] : [] };
}
