import { ProcessingFailure } from '../contracts';
import { sourcePackageShape } from './shape';
import type { SourceImportPackageV1, SourceImportIssue, SourceRef, SourceSetMetrics, SourceAttribute } from './types';

type Node = { type: string; key: string; parent: string | null; program: string | null; day: string | null;
  subject: string | null; definition: string | null; owner: string | null };
const linked = (ref: SourceRef) => ref.state === 'linked' ? ref.sourceKey : null;
const invalid = () => { throw new ProcessingFailure('SOURCE_PACKAGE_INVALID_REFERENCE'); };

export function requiredSourceIssues(pkg: SourceImportPackageV1): SourceImportIssue[] {
  const nodes = new Map<string, Node>();
  const byKey = new Map<string, Set<string>>();
  const issues: SourceImportIssue[] = [];
  function add(type: string, key: string, context: Partial<Omit<Node, 'type' | 'key'>> = {}) {
    const identity = type + '\0' + key;
    if (nodes.has(identity)) throw new ProcessingFailure('SOURCE_PACKAGE_DUPLICATE_KEY');
    if (nodes.size >= 512) throw new ProcessingFailure('SOURCE_PACKAGE_RESOURCE_LIMIT');
    const node: Node = { type, key, parent: null, program: null, day: null, subject: null, definition: null, owner: null, ...context };
    nodes.set(identity, node);
    const kinds = byKey.get(key) ?? new Set<string>();
    kinds.add(type);
    byKey.set(key, kinds);
    return node;
  }
  function positions(rows: readonly { position: number }[]) {
    if (new Set(rows.map(row => row.position)).size !== rows.length) invalid();
  }
  function report(code: string, node: Node, field: string, severity: SourceImportIssue['severity'] = 'warning') {
    issues.push({ code, severity, entityType: node.type, sourceKey: node.key, field });
    if (issues.length > 256) throw new ProcessingFailure('SOURCE_PACKAGE_RESOURCE_LIMIT');
  }
  function attributes(attrs: SourceAttribute[], node: Node, programSet = false) {
    if (new Set(attrs.map(attr => attr.name)).size !== attrs.length) invalid();
    for (const attr of attrs) {
      if (attr.kind === 'number' && attr.unit === null) report('UNKNOWN_UNIT', node, attr.name);
      if (programSet && attr.kind === 'number' && attr.name.startsWith('source_planned_')) {
        report('SOURCE_PROGRAM_NUMERIC_PRESCRIPTION', node, attr.name);
      }
    }
  }
  function metrics(value: SourceSetMetrics, node: Node) {
    const units = { weight: ['kg', 'g', 'lb', 'lbs'], duration: ['s', 'sec', 'ms', 'min', 'h'], distance: ['m', 'km', 'cm', 'mi', 'ft'] };
    for (const field of ['weight', 'duration', 'distance'] as const) {
      const measurement = value[field];
      if (measurement && (measurement.unit === null || !units[field].includes(measurement.unit))) {
        report('UNKNOWN_UNIT', node, field);
      }
    }
  }
  for (const row of pkg.subjects) attributes(row.sourceAttributes, add('subject', row.sourceKey));
  for (const row of pkg.sourceExercises) attributes(row.sourceAttributes, add('exercise', row.sourceKey));
  for (const program of pkg.programs) {
    const ctx = { program: program.sourceKey, subject: linked(program.subjectRef) };
    attributes(program.sourceAttributes, add('program', program.sourceKey, ctx));
    positions(program.phases);
    positions(program.days);
    for (const phase of program.phases) attributes(phase.sourceAttributes, add('phase', phase.sourceKey, ctx));
    for (const day of program.days) {
      const dayCtx = { ...ctx, day: day.sourceKey };
      attributes(day.sourceAttributes, add('day', day.sourceKey, dayCtx));
      positions(day.exercises);
      for (const exercise of day.exercises) {
        const exerciseCtx = { ...dayCtx, definition: exercise.exerciseSourceKey };
        attributes(exercise.sourceAttributes, add('programExercise', exercise.sourceKey, exerciseCtx));
        positions(exercise.sets);
        for (const set of exercise.sets) {
          attributes(set.sourceAttributes, add('programSet', set.sourceKey, { ...exerciseCtx, parent: exercise.sourceKey }), true);
        }
      }
    }
  }
  for (const workout of [...pkg.scheduledWorkouts, ...pkg.sessions]) {
    const isSession = 'frozenPlan' in workout;
    const ctx = { subject: linked(workout.subjectRef), program: linked(workout.programRef),
      day: 'programDayRef' in workout ? linked(workout.programDayRef) : null, owner: workout.sourceKey };
    attributes(workout.sourceAttributes, add(isSession ? 'session' : 'scheduledWorkout', workout.sourceKey, ctx));
    const plan = isSession ? workout.frozenPlan : workout.plan;
    const scope = (isSession ? 'session:' : 'occurrence:') + workout.sourceKey;
    if (plan.state === 'present') {
      positions(plan.exercises);
      for (const exercise of plan.exercises) {
        const exerciseCtx = { ...ctx, owner: scope, definition: exercise.exerciseSourceKey };
        add('planExercise', exercise.sourceKey, exerciseCtx);
        positions(exercise.sets);
        for (const set of exercise.sets) metrics(set.metrics, add('planSet', set.sourceKey, { ...exerciseCtx, parent: exercise.sourceKey }));
      }
    }
    if (isSession) {
      positions(workout.performedExercises);
      for (const exercise of workout.performedExercises) {
        const exerciseCtx = { ...ctx, owner: scope, definition: exercise.exerciseSourceKey };
        add('performedExercise', exercise.sourceKey, exerciseCtx);
        positions(exercise.sets);
        for (const set of exercise.sets) {
          const node = add('factSet', set.sourceKey, { ...exerciseCtx, parent: exercise.sourceKey });
          attributes(set.sourceAttributes, node);
          metrics(set.metrics, node);
        }
      }
    }
  }
  const node = (type: string, key: string) => {
    const found = nodes.get(type + '\0' + key);
    if (!found) return invalid();
    return found;
  };
  function reference(from: Node, ref: SourceRef, type: string, field: string,
    constraints: Partial<Pick<Node, 'program' | 'day' | 'parent' | 'owner' | 'definition'>> = {}) {
    if (ref.state !== 'linked') return null;
    const target = nodes.get(type + '\0' + ref.sourceKey);
    if (!target) {
      if (byKey.has(ref.sourceKey)) invalid();
      report('UNRESOLVED_SOURCE_REFERENCE', from, field, 'error');
      return null;
    }
    if (from.subject && target.subject && from.subject !== target.subject) invalid();
    for (const key of ['program', 'day', 'parent', 'owner', 'definition'] as const) {
      const expected = constraints[key];
      if (expected != null && target[key] !== expected) invalid();
    }
    return target;
  }
  const ref = (sourceKey: string): SourceRef => ({ state: 'linked', sourceKey });
  for (const program of pkg.programs) {
    reference(node('program', program.sourceKey), program.subjectRef, 'subject', 'subjectRef');
    for (const day of program.days) {
      const dayNode = node('day', day.sourceKey);
      reference(dayNode, day.phaseRef, 'phase', 'phaseRef', { program: program.sourceKey });
      for (const exercise of day.exercises) reference(node('programExercise', exercise.sourceKey),
        ref(exercise.exerciseSourceKey), 'exercise', 'exerciseSourceKey');
    }
  }
  for (const workout of [...pkg.scheduledWorkouts, ...pkg.sessions]) {
    const isSession = 'frozenPlan' in workout;
    const owner = node(isSession ? 'session' : 'scheduledWorkout', workout.sourceKey);
    reference(owner, workout.subjectRef, 'subject', 'subjectRef');
    reference(owner, workout.programRef, 'program', 'programRef');
    if ('programDayRef' in workout) reference(owner, workout.programDayRef, 'day', 'programDayRef', { program: owner.program });
    if (isSession) {
      const scheduled = reference(owner, workout.scheduledWorkoutRef, 'scheduledWorkout', 'scheduledWorkoutRef');
      if (scheduled && owner.program && scheduled.program && owner.program !== scheduled.program) invalid();
    }
    const plan = isSession ? workout.frozenPlan : workout.plan;
    if (plan.state === 'present') for (const exercise of plan.exercises) {
      const from = node('planExercise', exercise.sourceKey);
      reference(from, ref(exercise.exerciseSourceKey), 'exercise', 'exerciseSourceKey');
      const target = reference(from, exercise.sourceProgramExerciseRef, 'programExercise', 'sourceProgramExerciseRef',
        { program: owner.program, day: owner.day, definition: exercise.exerciseSourceKey });
      for (const set of exercise.sets) reference(node('planSet', set.sourceKey), set.sourceProgramSetRef, 'programSet',
        'sourceProgramSetRef', { parent: target?.key ?? linked(exercise.sourceProgramExerciseRef),
          program: owner.program, day: owner.day, definition: exercise.exerciseSourceKey });
    }
    if (isSession) for (const exercise of workout.performedExercises) {
      reference(node('performedExercise', exercise.sourceKey), ref(exercise.exerciseSourceKey), 'exercise', 'exerciseSourceKey');
      for (const set of exercise.sets) reference(node('factSet', set.sourceKey), set.planSetRef, 'planSet', 'planSetRef',
        { owner: 'session:' + workout.sourceKey, definition: exercise.exerciseSourceKey });
    }
  }
  return issues;
}

export type ExpectedSource = Pick<SourceImportPackageV1['provenance'], 'adapterId' | 'adapterVersion' | 'formatFamily' | 'inputSha256'>;

export function isSourceImportPackage(value: unknown, expected?: ExpectedSource): value is SourceImportPackageV1 {
  if (!sourcePackageShape(value)) return false;
  if (expected && (value.provenance.adapterId !== expected.adapterId || value.provenance.adapterVersion !== expected.adapterVersion
    || value.provenance.formatFamily !== expected.formatFamily || value.provenance.inputSha256 !== expected.inputSha256)) return false;
  try {
    const required = requiredSourceIssues(value);
    return required.every(issue => value.issues.some(found => found.code === issue.code && found.severity === issue.severity
      && found.entityType === issue.entityType && found.sourceKey === issue.sourceKey && found.field === issue.field));
  } catch { return false; }
}

export function sourcePackageStatus(value: unknown): 'invalid' | 'valid' | 'valid-with-issues' {
  if (!isSourceImportPackage(value)) return 'invalid';
  return value.issues.length ? 'valid-with-issues' : 'valid';
}
