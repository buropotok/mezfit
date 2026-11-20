import { assertBuildInput, assertPlan } from './validate';
import { canonical, digest } from './canonical';
import { convertMetrics } from './measure';
import { mapTiming } from './timing';
import type {
  SourceImportPackageV1, SourceRef, SourceSession, SourceScheduledWorkout, SourceProgram,
  SourcePlanPresence, SourceWorkoutTiming, SourceFactSet,
} from '../worker/processor/source-package/types';
import type {
  BuildMezfitImportPlanInput, MezfitImportPlanV1, ImportOperation, ImportOperationBase, TargetBinding,
  ExerciseMapping, ImportSelectionState, ImportSelection, MappingIssue, IssueCode, PlannedSnapshot,
  ConvertedFactSet, ProposedProgram, ProposedProgramExercise, ImportEntityKind, ExerciseTracking,
} from './types';

const linked = (ref: SourceRef): string | null => ref.state === 'linked' ? ref.sourceKey : null;
const sorted = <T extends { sourceKey: string }>(rows: readonly T[]): T[] =>
  [...rows].sort((a, b) => a.sourceKey.localeCompare(b.sourceKey, 'en'));
const ordered = <T extends { position: number; sourceKey: string }>(rows: readonly T[]): T[] =>
  [...rows].sort((a, b) => a.position - b.position || a.sourceKey.localeCompare(b.sourceKey, 'en'));
const normalize = (text: string): string => text.trim().normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ');

/** Use the source's IANA zone when deriving a business date from a trusted instant. */
function businessDate(timing: SourceWorkoutTiming): string | null {
  if (timing.localDate) return timing.localDate;
  const instant = timing.startedAtUtc ?? timing.completedAtUtc;
  if (!instant || !timing.timeZone) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timing.timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant));
  const d = Object.fromEntries(parts.map(item => [item.type, item.value]));
  return [d.year, d.month, d.day].join('-');
}
function inPeriod(date: string | null, from: string, through: string): boolean {
  return date === null || date >= from && date <= through;
}
function subjectKey(ref: SourceRef): string | null { return linked(ref); }
function sourceProgramForSession(session: SourceSession, scheduled: Map<string, SourceScheduledWorkout>): SourceRef {
  if (session.programRef.state === 'linked') return session.programRef;
  const occurrence = linked(session.scheduledWorkoutRef);
  const parent = occurrence ? scheduled.get(occurrence) : null;
  if (parent?.programRef.state === 'linked') return parent.programRef;
  return session.programRef;
}

/** Strictly pure and read-only; the resulting plan MUST be revalidated by a future Publisher. */
export async function buildMezfitImportPlan(raw: unknown): Promise<MezfitImportPlanV1> {
  assertBuildInput(raw);
  const input: BuildMezfitImportPlanInput = raw;
  const pkg: SourceImportPackageV1 = input.sourcePackage as SourceImportPackageV1;
  const sourceHash = await digest(pkg);
  const [catalogHash, targetHash, mappingHash, occupancyHash, existingHash, selectionHash] = await Promise.all([
    digest(input.catalogueSnapshot), digest(input.targetContextSnapshot), digest(input.mappingSnapshot),
    digest(input.calendarOccupancySnapshot), digest(input.existingImportsSnapshot), digest(input.selectionSnapshot),
  ]);
  const namespace = { sourceApp: pkg.provenance.sourceApp, formatFamily: pkg.provenance.formatFamily,
    formatVersion: pkg.provenance.formatVersion, datasetKey: input.targetContextSnapshot.datasetKey };
  const id = async (kind: string, subject: string, key: string): Promise<string> =>
    'imp:' + await digest({ namespace, kind, subject, key });
  const operations: ImportOperation[] = [];
  const issues: MappingIssue[] = [];
  const mappings: ExerciseMapping[] = [];
  const bindings: TargetBinding[] = [];
  const byProgram = new Map(pkg.programs.map(p => [p.sourceKey, p]));
  const bySchedule = new Map(pkg.scheduledWorkouts.map(w => [w.sourceKey, w]));
  const byExercise = new Map(pkg.sourceExercises.map(x => [x.sourceKey, x]));
  const bySubject = new Map(pkg.subjects.map(s => [s.sourceKey, s]));
  const coachExclusions = new Set(input.selectionSnapshot.exclusions.map(x => x.kind + '\u0000' + x.sourceKey));
  const alreadyImported = new Set(input.existingImportsSnapshot.identities);

  function report(code: IssueCode, entityKind: MappingIssue['entityKind'], sourceKey: string | null,
    operationKey: string | null, severity: MappingIssue['severity'] = 'error'): void {
    issues.push({ code, entityKind, sourceKey, operationKey, severity });
  }
  function base(key: string, target: string,
    refs: ImportOperationBase['sourceRefs'], deps: string[] = []): ImportOperationBase {
    return { operationKey: key, targetBindingRef: target, sourceRefs: refs,
      dependencyKeys: [...new Set(deps)].sort(), state: alreadyImported.has(key) ? 'already_imported' : 'selected',
      reasonCodes: [], evidence: { sourcePackageSha256: sourceHash,
        datasetKey: input.targetContextSnapshot.datasetKey }, losses: [] };
  }
  const bindingBySubject = new Map<string, TargetBinding>();
  for (const subject of sorted(pkg.subjects)) {
    const provided = input.targetContextSnapshot.bindings.find(x => x.sourceSubjectKey === subject.sourceKey);
    const key = await id('binding', subject.sourceKey, subject.sourceKey);
    const binding: TargetBinding = provided?.kind === 'existing_client'
      ? { key, sourceSubjectKey: subject.sourceKey, kind: 'existing_client', targetClientId: provided.targetClientId }
      : provided?.kind === 'provisional_imported_client'
        ? { key, sourceSubjectKey: subject.sourceKey, kind: 'provisional_imported_client', provisionalKey: provided.provisionalKey }
        : { key, sourceSubjectKey: subject.sourceKey, kind: 'unresolved' };
    bindings.push(binding);
    bindingBySubject.set(subject.sourceKey, binding);
  }
  function bindingRef(source: string | null, kind: MappingIssue['entityKind'], recordKey: string,
    opKey: string): { ref: string; reasons: IssueCode[] } {
    const binding = source ? bindingBySubject.get(source) : null;
    if (!binding || binding.kind === 'unresolved') {
      report('UNRESOLVED_SUBJECT', kind, recordKey, opKey);
      return { ref: binding?.key ?? 'source-only', reasons: ['UNRESOLVED_SUBJECT'] };
    }
    return { ref: binding.key, reasons: [] };
  }
  function evaluateDate(timing: SourceWorkoutTiming, kind: 'session' | 'scheduledWorkout', sourceKey: string):
    { date: string | null; selected: boolean } {
    const date = businessDate(timing);
    if (date === null) report('UNKNOWN_BUSINESS_DATE', kind, sourceKey, null);
    return { date, selected: inPeriod(date, input.period.fromDate, input.period.throughDate) };
  }
  // IMPORTANT: all session-to-scheduled linked keys are collected BEFORE any temporal filtering.
  const scheduleLinks = new Set(pkg.sessions.flatMap(s => s.scheduledWorkoutRef.state === 'linked'
    ? [s.scheduledWorkoutRef.sourceKey] : []));
  const selectedSessions: SourceSession[] = [];
  const selectedScheduled: SourceScheduledWorkout[] = [];
  let outsideSessions = 0;
  let outsideScheduled = 0;
  let suppressed = 0;
  for (const session of sorted(pkg.sessions)) {
    if (evaluateDate(session.timing, 'session', session.sourceKey).selected) selectedSessions.push(session);
    else outsideSessions++;
  }
  for (const schedule of sorted(pkg.scheduledWorkouts)) {
    if (!evaluateDate(schedule.timing, 'scheduledWorkout', schedule.sourceKey).selected) { outsideScheduled++; continue; }
    if (scheduleLinks.has(schedule.sourceKey)) { suppressed++; continue; }
    selectedScheduled.push(schedule);
  }
  const requiredPrograms = new Map<string, SourceProgram>();
  const candidates = [...selectedSessions.map(x => ({ subject: subjectKey(x.subjectRef), ref: sourceProgramForSession(x, bySchedule) })),
    ...selectedScheduled.map(x => ({ subject: subjectKey(x.subjectRef), ref: x.programRef }))];
  for (const { ref } of candidates) {
    const k = linked(ref);
    if (k && byProgram.has(k)) requiredPrograms.set(k, byProgram.get(k)!);
  }
  const selectedBySubject = new Map<string, SourceSession[]>();
  for (const session of selectedSessions) {
    const k = subjectKey(session.subjectRef);
    if (!k) continue;
    const list = selectedBySubject.get(k) ?? [];
    list.push(session);
    selectedBySubject.set(k, list);
  }
  const synthetic = new Map<string, SourceSession | null>();
  const completedSourceSessionMissing = (subject: string, selected: Map<string, SourceSession[]>): boolean =>
    !selected.get(subject)?.some(s => s.completionState === 'completed');
  const selectedSubjects = new Set([
    ...selectedSessions.map(s => subjectKey(s.subjectRef)),
    ...selectedScheduled.map(w => subjectKey(w.subjectRef)),
  ].filter((key): key is string => key !== null));
  for (const subject of [...selectedSubjects].sort((a, b) => a.localeCompare(b, 'en'))) {
    const sessions = selectedBySubject.get(subject) ?? [];
    const schedules = selectedScheduled.filter(w => subjectKey(w.subjectRef) === subject);
    const noPrograms = sessions.every(s => {
      if (s.programRef.state !== 'none') return false;
      if (s.scheduledWorkoutRef.state === 'none') return true;
      if (s.scheduledWorkoutRef.state !== 'linked') return false;
      return bySchedule.get(s.scheduledWorkoutRef.sourceKey)?.programRef.state === 'none';
    }) && schedules.every(s => s.programRef.state === 'none');
    if (!noPrograms || pkg.coverage.programs !== 'complete'
      || pkg.coverage.scheduledWorkouts !== 'complete' || pkg.coverage.sessions !== 'complete') continue;
    if (sessions.some(s => s.completionState === 'completed' && !businessDate(s.timing))) {
      report('AMBIGUOUS_LAST_SESSION', 'program', subject, null);
      synthetic.set(subject, null);
      continue;
    }
    const completed = sessions.filter(s => s.completionState === 'completed' && businessDate(s.timing));
    const orderedSessions = [...completed].sort((a, b) => {
      const da = businessDate(a.timing) ?? '';
      const db = businessDate(b.timing) ?? '';
      return db.localeCompare(da, 'en') ||
        (b.timing.completedAtUtc ?? '').localeCompare(a.timing.completedAtUtc ?? '', 'en');
    });
    const newest = orderedSessions[0] ?? null;
    if (!newest) report('NO_COMPLETED_SESSION', 'program', subject, null);
    else if (orderedSessions[1]
      && businessDate(orderedSessions[1].timing) === businessDate(newest.timing)
      && (!orderedSessions[1].timing.completedAtUtc || !newest.timing.completedAtUtc
        || orderedSessions[1].timing.completedAtUtc === newest.timing.completedAtUtc)) {
      report('AMBIGUOUS_LAST_SESSION', 'program', subject, null);
      synthetic.set(subject, null);
      continue;
    }
    synthetic.set(subject, newest);
  }

  // Closure contains the ENTIRE referenced program graph, not workout-specific slices.
  const used = new Map<string, { subject: string; exerciseKey: string }>();
  const use = (subject: string | null, exerciseKey: string) => {
    if (subject && bySubject.has(subject)) used.set(subject + '\u0000' + exerciseKey, { subject, exerciseKey });
  };
  for (const program of requiredPrograms.values()) for (const day of program.days)
    for (const exercise of day.exercises) use(subjectKey(program.subjectRef), exercise.exerciseSourceKey);
  for (const session of selectedSessions) {
    const subject = subjectKey(session.subjectRef);
    if (session.frozenPlan.state === 'present') for (const exercise of session.frozenPlan.exercises)
      use(subject, exercise.exerciseSourceKey);
    for (const exercise of session.performedExercises) use(subject, exercise.exerciseSourceKey);
  }
  for (const schedule of selectedScheduled) if (schedule.plan.state === 'present')
    for (const exercise of schedule.plan.exercises) use(subjectKey(schedule.subjectRef), exercise.exerciseSourceKey);
  const mappingByUse = new Map<string, ExerciseMapping>();
  for (const { subject, exerciseKey } of [...used.values()]
    .sort((a, b) => (a.subject + a.exerciseKey).localeCompare(b.subject + b.exerciseKey, 'en'))) {
    const source = byExercise.get(exerciseKey);
    const identityKey = await id('exercise', subject, exerciseKey);
    const mapKey = subject + '\u0000' + exerciseKey;
    let mapping: ExerciseMapping;
    const name = source?.sourceName?.trim() ?? '';
    const trackingHint = source?.trackingHint;
    const registered = input.mappingSnapshot.entries.find(entry => entry.identityKey === identityKey);
    const registeredTarget = registered
      ? input.catalogueSnapshot.entries.find(entry => entry.id === registered.catalogueExerciseId) : undefined;
    if (!source || !name) {
      mapping = { kind: 'blocked', identityKey, sourceExerciseKey: exerciseKey, sourceSubjectKey: subject,
        reason: source ? 'UNRESOLVED_EXERCISE' : 'MISSING_EXERCISE' };
    } else if (registered && !registeredTarget) {
      mapping = { kind: 'blocked', identityKey, sourceExerciseKey: exerciseKey, sourceSubjectKey: subject,
        reason: 'UNRESOLVED_EXERCISE' };
    } else if (registeredTarget && (!trackingHint || trackingHint === registeredTarget.trackingType)) {
      mapping = { kind: 'catalog_match', identityKey, sourceExerciseKey: exerciseKey, sourceSubjectKey: subject,
        catalogueExerciseId: registeredTarget.id, trackingType: registeredTarget.trackingType, matchEvidence: 'reviewed_registry' };
    } else if (registeredTarget) {
      mapping = { kind: 'blocked', identityKey, sourceExerciseKey: exerciseKey, sourceSubjectKey: subject,
        reason: 'TRACKING_METRICS_CONFLICT' };
    } else if (!trackingHint) {
      mapping = { kind: 'blocked', identityKey, sourceExerciseKey: exerciseKey, sourceSubjectKey: subject,
        reason: 'UNKNOWN_TRACKING' };
    } else {
      // Unique exact match only when both name, tracking AND equipment evidence are compatible.
      const equipmentEvidence = source.equipment?.trim();
      const matches = equipmentEvidence ? input.catalogueSnapshot.entries.filter(entry =>
        normalize(entry.name) === normalize(name) && entry.trackingType === trackingHint
        && !!entry.equipment?.trim() && normalize(entry.equipment) === normalize(equipmentEvidence)) : [];
      if (matches.length === 1 && input.catalogueSnapshot.completeness === 'complete') {
        mapping = { kind: 'catalog_match', identityKey, sourceExerciseKey: exerciseKey, sourceSubjectKey: subject,
          catalogueExerciseId: matches[0].id, trackingType: trackingHint, matchEvidence: 'exact_unique' };
      } else {
        const key = await id('customExercise', subject, exerciseKey);
        mapping = { kind: 'proposed_custom', identityKey, sourceExerciseKey: exerciseKey, sourceSubjectKey: subject,
          operationKey: key, trackingType: trackingHint, requiresReconciliation: true };
        const target = bindingRef(subject, 'customExercise', exerciseKey, key);
        const operation: ImportOperation = { ...base(key, target.ref, [{ kind: 'exercise', sourceKey: exerciseKey }]),
          kind: 'proposed_custom_exercise', exerciseIdentityKey: identityKey, sourceName: name,
          trackingType: trackingHint, requiresReconciliation: true, targetScope: 'coach' };
        operation.reasonCodes.push(...target.reasons);
        operations.push(operation);
      }
    }
    mappingByUse.set(mapKey, mapping);
    mappings.push(mapping);
    if (mapping.kind === 'blocked') report(mapping.reason, 'customExercise', exerciseKey, null);
  }
  const mappingKey = (subject: string | null, exerciseKey: string): string =>
    (subject ? mappingByUse.get(subject + '\u0000' + exerciseKey)?.identityKey : null) ?? 'unresolved:' + exerciseKey;
  const dependencies = (keys: string[]): string[] => [...new Set(keys.flatMap(k => {
    const mapping = mappings.find(m => m.identityKey === k);
    return mapping?.kind === 'proposed_custom' ? [mapping.operationKey] : [];
  }))].sort();
  const badMappings = (keys: string[]): boolean =>
    keys.some(k => !mappings.some(m => m.identityKey === k && m.kind !== 'blocked'));
  const knownSetType = (type: string | null): boolean => type === null ||
    ['dropset', 'isometrics', 'cluster', 'rest_pause', 'tempo_superset', 'partial_reps'].includes(type);
  const knownSetLabel = (type: string | null): boolean => type === null ||
    ['warmup', 'easy', 'normal', 'hard', 'drop'].includes(type);
  function flag(operation: ImportOperation, code: IssueCode, severity: MappingIssue['severity'] = 'error'): void {
    if (!operation.reasonCodes.includes(code)) operation.reasonCodes.push(code);
    report(code, operation.kind === 'historical_session' ? 'session'
      : operation.kind === 'standalone_scheduled' ? 'scheduledWorkout'
        : operation.kind === 'proposed_custom_exercise' ? 'customExercise'
          : operation.kind === 'provenance_metadata' ? 'provenance' : operation.kind, operation.sourceRefs[0]?.sourceKey ?? null, operation.operationKey, severity);
  }
  function addLoss(operation: ImportOperation, code: IssueCode): void {
    if (!operation.losses.includes(code)) operation.losses.push(code);
    report(code, operation.kind === 'historical_session' ? 'session'
      : operation.kind === 'standalone_scheduled' ? 'scheduledWorkout' : 'program',
      operation.sourceRefs[0]?.sourceKey ?? null, operation.operationKey, 'warning');
  }
  let convertedSets = 0;
  function snapshot(source: SourcePlanPresence, subject: string | null, operation: ImportOperation):
    PlannedSnapshot {
    if (source.state !== 'present') return { state: source.state };
    return { state: 'present', exercises: ordered(source.exercises).map(ex => ({
      sourceKey: ex.sourceKey, position: ex.position,
      exerciseMappingKey: mappingKey(subject, ex.exerciseSourceKey),
      sourceProgramExerciseRef: ex.sourceProgramExerciseRef,
      sets: ordered(ex.sets).map(set => {
        const mapping = subject ? mappingByUse.get(subject + '\u0000' + ex.exerciseSourceKey) : null;
        const result = mapping && mapping.kind !== 'blocked' ? convertMetrics(set.metrics, mapping.trackingType) : null;
        if (result?.metrics) convertedSets++;
        else if (result) for (const issue of result.issues) flag(operation, issue);
        if (!knownSetType(set.sourceSetType)) flag(operation, 'UNSUPPORTED_SET_METADATA');
        return { sourceKey: set.sourceKey, position: set.position, sourceProgramSetRef: set.sourceProgramSetRef,
          sourceSetType: set.sourceSetType, sourceMetrics: set.metrics,
          metrics: result?.metrics ?? { reps: null, weight: null, duration: null, distance: null } };
      }),
    })) };
  }
  function convertFact(set: SourceFactSet, mapping: ExerciseMapping | undefined, operation: ImportOperation): ConvertedFactSet {
    const result = mapping && mapping.kind !== 'blocked' ? convertMetrics(set.metrics, mapping.trackingType) : null;
    if (result?.metrics) convertedSets++;
    else if (result) for (const issue of result.issues) flag(operation, issue);
    if (!knownSetType(set.sourceSetType) || !knownSetLabel(set.sourceSetLabel)) flag(operation, 'UNSUPPORTED_SET_METADATA');
    if (set.setStatus === 'unknown') flag(operation, 'UNSUPPORTED_FACT_STATUS');
    if (set.rpe === 0) flag(operation, 'UNSUPPORTED_SET_METADATA');
    if (set.sourceAttributes.length) addLoss(operation, 'UNSUPPORTED_SOURCE_ATTRIBUTES');
    return { sourceKey: set.sourceKey, position: set.position, planSetRef: set.planSetRef,
      sourceSetType: set.sourceSetType, sourceSetLabel: set.sourceSetLabel,
      sourceMetrics: set.metrics,
      metrics: result?.metrics ?? { reps: null, weight: null, duration: null, distance: null },
      setStatus: set.setStatus, rpe: set.rpe, comment: set.comment, sourceAttributes: set.sourceAttributes };
  }
  const programOps = new Map<string, string>();
  const makeProgramExercises = (subject: string | null, exs: Array<{
    sourceKey: string; exerciseSourceKey: string; position: number; notes: string | null;
    sets: Array<{ sourceKey: string; position: number; sourceSetType: string | null;
      sourceSetLabel: string | null; comment: string | null; sourceAttributes: SourceProgram['days'][number]['exercises'][number]['sets'][number]['sourceAttributes'] }> }>,
  ): ProposedProgramExercise[] => ordered(exs).map(ex => ({
    sourceKey: ex.sourceKey, position: ex.position, exerciseMappingKey: mappingKey(subject, ex.exerciseSourceKey),
    notes: ex.notes, sets: ordered(ex.sets).map(set => ({
      sourceKey: set.sourceKey, position: set.position, setType: set.sourceSetType,
      setLabel: set.sourceSetLabel, comment: set.comment, sourceAttributes: set.sourceAttributes,
    })),
  }));
  for (const program of sorted([...requiredPrograms.values()])) {
    const subject = subjectKey(program.subjectRef);
    const key = await id('program', subject ?? 'unknown', program.sourceKey);
    const b = bindingRef(subject, 'program', program.sourceKey, key);
    const payload: ProposedProgram = {
      sourceProgramKey: program.sourceKey, syntheticFromSessionKey: null, name: program.name,
      intendedStatus: 'active',
      phases: ordered(program.phases).map(p => ({ sourceKey: p.sourceKey, name: p.name, position: p.position })),
      days: ordered(program.days).map(day => ({
        sourceKey: day.sourceKey, position: day.position, phaseRef: day.phaseRef, name: day.name,
        exercises: makeProgramExercises(subject, day.exercises),
      })),
    };
    const exKeys = payload.days.flatMap(day => day.exercises.map(ex => ex.exerciseMappingKey));
    const operation: ImportOperation = { ...base(key, b.ref, [{ kind: 'program', sourceKey: program.sourceKey }],
      dependencies(exKeys)), kind: 'program', program: payload };
    operation.reasonCodes.push(...b.reasons);
    if (badMappings(exKeys)) flag(operation, 'UNRESOLVED_EXERCISE');
    if (!program.name?.trim() || !program.phases.length
      || program.days.some(day => day.phaseRef.state !== 'linked'
        || !program.phases.some(phase => phase.sourceKey === day.phaseRef.sourceKey)))
      flag(operation, 'INVALID_DEPENDENCY');
    if (subject && input.targetContextSnapshot.activeProgramSubjectKeys.includes(subject))
      flag(operation, 'ACTIVE_PROGRAM_CONFLICT');
    if (coachExclusions.has('program\u0000' + program.sourceKey))
      operation.state = 'excluded_by_coach';
    for (const day of program.days) for (const ex of day.exercises) for (const set of ex.sets) {
      if (!knownSetType(set.sourceSetType) || !knownSetLabel(set.sourceSetLabel)) flag(operation, 'UNSUPPORTED_SET_METADATA');
      if (set.sourceAttributes.some(a => a.kind === 'number' && a.name.startsWith('source_planned_')))
        addLoss(operation, 'SOURCE_PROGRAM_NUMERIC_PRESCRIPTION');
    }
    if (program.sourceAttributes.length || program.phases.some(p => p.sourceAttributes.length)
      || program.days.some(d => d.sourceAttributes.length
        || d.exercises.some(ex => ex.sourceAttributes.length))) addLoss(operation, 'UNSUPPORTED_SOURCE_ATTRIBUTES');
    programOps.set(program.sourceKey, key);
    operations.push(operation);
  }
  for (const [subject, last] of [...synthetic].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    const key = await id('syntheticProgram', subject, 'default');
    const b = bindingRef(subject, 'program', subject, key);
    const exercises: ProposedProgramExercise[] = last ? ordered(last.performedExercises).map(ex => ({
      sourceKey: ex.sourceKey, position: ex.position, exerciseMappingKey: mappingKey(subject, ex.exerciseSourceKey),
      notes: ex.notes,
      sets: ordered(ex.sets).map(set => ({
        sourceKey: set.sourceKey, position: set.position, setType: set.sourceSetType,
        setLabel: set.sourceSetLabel, comment: set.comment, sourceAttributes: set.sourceAttributes,
      })),
    })) : [];
    const exKeys = exercises.map(ex => ex.exerciseMappingKey);
    const operation: ImportOperation = { ...base(key, b.ref, last ? [{ kind: 'session', sourceKey: last.sourceKey }] : [],
      dependencies(exKeys)), kind: 'program',
      program: { sourceProgramKey: null, syntheticFromSessionKey: last?.sourceKey ?? null,
        name: last?.name ?? null, intendedStatus: 'active',
        phases: [{ sourceKey: 'synthetic:phase', name: null, position: 0 }],
        days: [{ sourceKey: 'synthetic:day', name: null, position: 0,
          phaseRef: { state: 'linked', sourceKey: 'synthetic:phase' }, exercises }] } };
    operation.reasonCodes.push(...b.reasons);
    if (!last) flag(operation, completedSourceSessionMissing(subject, selectedBySubject)
      ? 'NO_COMPLETED_SESSION' : 'AMBIGUOUS_LAST_SESSION');
    if (last && !last.name?.trim()) flag(operation, 'INVALID_DEPENDENCY');
    if (badMappings(exKeys)) flag(operation, 'UNRESOLVED_EXERCISE');
    if (input.targetContextSnapshot.activeProgramSubjectKeys.includes(subject))
      flag(operation, 'ACTIVE_PROGRAM_CONFLICT');
    operations.push(operation);
  }
  const stagedSlots: string[] = [];
  for (const session of selectedSessions) {
    const subject = subjectKey(session.subjectRef);
    const key = await id('session', subject ?? 'unknown', session.sourceKey);
    const b = bindingRef(subject, 'session', session.sourceKey, key);
    const programRef = sourceProgramForSession(session, bySchedule);
    const programKey = linked(programRef);
    const dep = programKey && programOps.has(programKey) ? [programOps.get(programKey)!] : [];
    const timed = mapTiming(session.timing, input.evaluatedAtUtc, 'session',
      input.calendarOccupancySnapshot.intervals, stagedSlots);
    const operation: ImportOperation = { ...base(key, b.ref, [{ kind: 'session', sourceKey: session.sourceKey }],
      dep), kind: 'historical_session', completionState: session.completionState,
      programRef, scheduledWorkoutRef: session.scheduledWorkoutRef,
      timing: timed.timing,
      frozenPlan: { state: 'absent' }, fact: [], importedProvenance: true };
    operation.reasonCodes.push(...b.reasons);
    if (session.completionState !== 'completed') flag(operation, 'UNKNOWN_COMPLETION');
    if (!businessDate(session.timing)) flag(operation, 'UNKNOWN_BUSINESS_DATE');
    if (programRef.state === 'unknown' || programKey && !byProgram.has(programKey))
      flag(operation, 'UNKNOWN_PROGRAM_RELATION');
    if (session.scheduledWorkoutRef.state === 'unknown'
      || linked(session.scheduledWorkoutRef) && !bySchedule.has(linked(session.scheduledWorkoutRef)!))
      flag(operation, 'SCHEDULE_LINK_UNCERTAIN');
    for (const code of timed.issues)
      if (code === 'TIME_INFERRED') report(code, 'session', session.sourceKey, key, 'info');
      else if (code !== 'UNKNOWN_BUSINESS_DATE' || !businessDate(session.timing)) flag(operation, code);
    operation.frozenPlan = snapshot(session.frozenPlan, subject, operation);
    if (session.frozenPlan.state === 'unknown') report('UNKNOWN_PLAN', 'session', session.sourceKey, key, 'warning');
    operation.fact = ordered(session.performedExercises).map(ex => ({
      sourceKey: ex.sourceKey, position: ex.position, exerciseMappingKey: mappingKey(subject, ex.exerciseSourceKey),
      notes: ex.notes, sets: ordered(ex.sets).map(set =>
        convertFact(set, subject ? mappingByUse.get(subject + '\u0000' + ex.exerciseSourceKey) : undefined, operation)),
    }));
    const exKeys = [
      ...operation.fact.map(x => x.exerciseMappingKey),
      ...(operation.frozenPlan.state === 'present'
        ? operation.frozenPlan.exercises.map(x => x.exerciseMappingKey) : []),
    ];
    operation.dependencyKeys.push(...dependencies(exKeys));
    operation.dependencyKeys = [...new Set(operation.dependencyKeys)].sort();
    if (badMappings(exKeys)) flag(operation, 'UNRESOLVED_EXERCISE');
    if (session.sourceAttributes.length || session.performedExercises.some(ex => ex.sets.some(s => s.sourceAttributes.length)))
      addLoss(operation, 'UNSUPPORTED_SOURCE_ATTRIBUTES');
    if (coachExclusions.has('session\u0000' + session.sourceKey)) operation.state = 'excluded_by_coach';
    operations.push(operation);
    const provenanceKey = await id('provenance', subject ?? 'unknown', session.sourceKey);
    const provenance: ImportOperation = { ...base(provenanceKey, b.ref,
      [{ kind: 'session', sourceKey: session.sourceKey }], [key]),
      kind: 'provenance_metadata', forOperationKey: key, marker: 'imported' };
    if (operation.state === 'already_imported') provenance.state = 'already_imported';
    operations.push(provenance);
  }
  for (const schedule of selectedScheduled) {
    const subject = subjectKey(schedule.subjectRef);
    const key = await id('scheduled', subject ?? 'unknown', schedule.sourceKey);
    const b = bindingRef(subject, 'scheduledWorkout', schedule.sourceKey, key);
    const programKey = linked(schedule.programRef);
    const deps = programKey && programOps.has(programKey) ? [programOps.get(programKey)!] : [];
    const timed = mapTiming(schedule.timing, input.evaluatedAtUtc, 'scheduled',
      input.calendarOccupancySnapshot.intervals, stagedSlots);
    const operation: ImportOperation = { ...base(key, b.ref,
      [{ kind: 'scheduledWorkout', sourceKey: schedule.sourceKey }], deps),
      kind: 'standalone_scheduled', programRef: schedule.programRef,
      programDayRef: schedule.programDayRef, timing: timed.timing, plan: { state: 'absent' } };
    operation.reasonCodes.push(...b.reasons);
    if (!businessDate(schedule.timing)) flag(operation, 'UNKNOWN_BUSINESS_DATE');
    if (schedule.programRef.state === 'unknown' || programKey && !byProgram.has(programKey))
      flag(operation, 'UNKNOWN_PROGRAM_RELATION');
    if (schedule.programDayRef.state === 'unknown'
      || linked(schedule.programDayRef) && !programKey) flag(operation, 'MISSING_SOURCE_REFERENCE');
    if (pkg.coverage.sessions !== 'complete'
      || selectedSessions.some(s => subjectKey(s.subjectRef) === subject && s.scheduledWorkoutRef.state === 'unknown'))
      flag(operation, 'SCHEDULE_LINK_UNCERTAIN');
    for (const code of timed.issues)
      if (code === 'TIME_INFERRED') report(code, 'scheduledWorkout', schedule.sourceKey, key, 'info');
      else if (code !== 'UNKNOWN_BUSINESS_DATE' || !businessDate(schedule.timing)) flag(operation, code);
    operation.plan = snapshot(schedule.plan, subject, operation);
    if (schedule.plan.state === 'unknown') flag(operation, 'UNKNOWN_PLAN');
    const exKeys = operation.plan.state === 'present' ? operation.plan.exercises.map(x => x.exerciseMappingKey) : [];
    operation.dependencyKeys.push(...dependencies(exKeys));
    operation.dependencyKeys = [...new Set(operation.dependencyKeys)].sort();
    if (badMappings(exKeys)) flag(operation, 'UNRESOLVED_EXERCISE');
    if (schedule.sourceAttributes.length) addLoss(operation, 'UNSUPPORTED_SOURCE_ATTRIBUTES');
    if (coachExclusions.has('scheduledWorkout\u0000' + schedule.sourceKey))
      operation.state = 'excluded_by_coach';
    operations.push(operation);
  }
  // Closed dependency graph: a selected operation cannot retain a blocked/excluded parent.
  const opByKey = new Map(operations.map(o => [o.operationKey, o]));
  const blockingCodes = new Set<IssueCode>([
    'UNKNOWN_BUSINESS_DATE', 'UNKNOWN_SOURCE_TIMEZONE', 'MISSING_SOURCE_REFERENCE',
    'UNRESOLVED_SUBJECT', 'UNKNOWN_PROGRAM_RELATION', 'ACTIVE_PROGRAM_CONFLICT',
    'UNKNOWN_COMPLETION', 'SCHEDULE_LINK_UNCERTAIN', 'SCHEDULE_END_UNKNOWN',
    'MISSING_EXERCISE', 'UNRESOLVED_EXERCISE', 'UNKNOWN_TRACKING',
    'UNSUPPORTED_UNIT', 'TRACKING_METRICS_CONFLICT', 'UNSUPPORTED_SET_METADATA',
    'AMBIGUOUS_LAST_SESSION', 'NO_COMPLETED_SESSION', 'TIME_COLLISION',
    'TIME_SLOT_EXHAUSTED', 'TIME_DURATION_UNKNOWN', 'INVALID_DEPENDENCY',
    'BLOCKED_DEPENDENCY', 'UNKNOWN_PLAN', 'UNSUPPORTED_FACT_STATUS',
  ]);
  for (const operation of operations) {
    if (operation.state === 'selected' && operation.reasonCodes.some(c => blockingCodes.has(c)))
      operation.state = 'blocked';
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const operation of operations) {
      if (operation.state !== 'selected') continue;
      if (operation.dependencyKeys.some(dep => {
        const parent = opByKey.get(dep);
        return !parent || parent.state === 'blocked' || parent.state === 'excluded_by_coach';
      })) {
        operation.state = 'blocked';
        flag(operation, 'BLOCKED_DEPENDENCY');
        changed = true;
      }
    }
  }
  operations.sort((a, b) => a.operationKey.localeCompare(b.operationKey, 'en'));
  mappings.sort((a, b) => a.identityKey.localeCompare(b.identityKey, 'en'));
  function closure(key: string, visited = new Set<string>()): string[] {
    for (const dep of opByKey.get(key)?.dependencyKeys ?? []) if (!visited.has(dep)) {
      visited.add(dep);
      closure(dep, visited);
    }
    return [...visited].sort();
  }
  const selections: ImportSelection[] = operations.map(o => ({
    groupKey: o.operationKey, operationKeys: [o.operationKey], state: o.state,
    reasonCodes: [...o.reasonCodes], dependencyClosure: closure(o.operationKey),
  }));
  const omitted = pkg.omittedData.map(item => ({ ...item }));
  if (pkg.omittedData.some(item => item.category === 'measures' && (item.count ?? 0) > 0))
    report('OMITTED_MEASURES', 'source', null, null, 'warning');
  const byCode = new Map<IssueCode, number>();
  for (const item of issues) byCode.set(item.code, (byCode.get(item.code) ?? 0) + 1);
  issues.sort((a, b) => canonical(a).localeCompare(canonical(b), 'en'));
  const count = (kind: ImportOperation['kind'], state: ImportSelectionState = 'selected') =>
    operations.filter(o => o.kind === kind && o.state === state).length;
  const preview: MezfitImportPlanV1['preview'] = {
    source: { sessions: pkg.sessions.length, scheduledWorkouts: pkg.scheduledWorkouts.length,
      programs: pkg.programs.length, exercises: pkg.sourceExercises.length },
    selected: { sessions: count('historical_session'), scheduledWorkouts: count('standalone_scheduled'),
      programs: count('program') },
    outsidePeriod: { sessions: outsideSessions, scheduledWorkouts: outsideScheduled },
    linkedScheduledSuppressed: suppressed,
    blocked: operations.filter(o => o.state === 'blocked').length,
    excludedByCoach: operations.filter(o => o.state === 'excluded_by_coach').length,
    alreadyImported: operations.filter(o => o.state === 'already_imported').length,
    catalogMatched: mappings.filter(m => m.kind === 'catalog_match').length,
    proposedCustomExercises: operations.filter(o => o.kind === 'proposed_custom_exercise').length,
    convertedSets,
    incompleteSessions: selectedSessions.filter(s => s.completionState !== 'completed').length,
    omittedMeasures: pkg.omittedData.filter(x => x.category === 'measures').reduce((n, x) => n + (x.count ?? 0), 0),
    issuesByCode: [...byCode].sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([code, n]) => ({ code, count: n })),
  };
  const readyOps = operations.some(o => o.state === 'selected');
  const readiness = preview.blocked
    ? readyOps ? 'requires_decisions' : 'blocked' : 'ready_for_review';
  const data = {
    kind: 'mezfit.import-plan' as const, schemaVersion: 1 as const,
    policyVersion: input.policyVersion,
    source: { packageSha256: sourceHash, datasetKey: input.targetContextSnapshot.datasetKey,
      sourceApp: pkg.provenance.sourceApp, formatFamily: pkg.provenance.formatFamily,
      adapterId: pkg.provenance.adapterId, adapterVersion: pkg.provenance.adapterVersion,
      inputSha256: pkg.provenance.inputSha256 },
    scope: { ...input.period, evaluatedAtUtc: input.evaluatedAtUtc,
      selectedEntityTypes: ['session', 'scheduledWorkout'] as ['session', 'scheduledWorkout'],
      programs: 'linked-only' as const },
    inputs: { catalogSnapshotHash: catalogHash, targetSnapshotHash: targetHash,
      mappingSnapshotHash: mappingHash, occupancySnapshotHash: occupancyHash,
      existingImportsSnapshotHash: existingHash, selectionSnapshotHash: selectionHash },
    targetBindings: bindings, exerciseMappings: mappings, operations, selections, issues,
    omittedData: omitted, preview, readiness,
  };
  const plan: MezfitImportPlanV1 = { ...data, planId: await digest(data) };
  assertPlan(plan);
  return plan;
}
