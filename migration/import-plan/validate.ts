import { planRule, type ImportOperation, type MappedPlan, type MezfitImportPlanV1 } from './contracts';
import { mapMetrics } from './measures';
import { businessDate, exactStart } from './timing';
import { canonical, compare, hash, jsonSnapshot } from './schema';

type SummaryInput = Pick<MezfitImportPlanV1, 'selections' | 'operations' | 'exerciseMappings' | 'issues' | 'omittedData' | 'source'>;

function planSets(plan: MappedPlan) {
  return plan.state === 'present' ? plan.exercises.flatMap(row => row.sets) : [];
}

export function summarize(value: SummaryInput): Pick<MezfitImportPlanV1, 'preview' | 'readiness'> {
  const { selections, operations, issues, exerciseMappings, omittedData } = value;
  const status = (name: typeof selections[number]['status']) => selections.filter(group => group.status === name).length;
  const ready = new Set(selections.filter(group => group.status === 'selected').map(group => group.groupKey));
  const measures = omittedData.filter(row => row.category === 'measures');
  const totalMeasures = measures.reduce((sum, row) => sum + (row.count ?? 0), 0);
  const omittedMeasures = measures.some(row => row.count === null) || !Number.isSafeInteger(totalMeasures) ? null : totalMeasures;
  const selectedWorkouts = selections.filter(group => group.status === 'selected'
    && (group.origin.type === 'session' || group.origin.type === 'scheduledWorkout')).length;
  const pending = status('blocked') > 0 || issues.some(issue => issue.code === 'SNAPSHOT_UNRESOLVED' || issue.code === 'UNKNOWN_SCHEDULE_END');
  const readiness = pending ? (ready.size ? 'requires_decisions' : 'blocked')
    : selectedWorkouts || ready.size ? 'ready_for_review' : 'blocked';
  let convertedSets = 0;
  for (const operation of operations) {
    const sets = operation.kind === 'historical_session'
      ? [...planSets(operation.frozenPlan), ...operation.fact.flatMap(row => row.sets)]
      : operation.kind === 'standalone_scheduled' ? planSets(operation.plan) : [];
    convertedSets += sets.filter(set => set.metrics.converted !== null).length;
  }
  const preview = {
    sourceSessions: selections.filter(row => row.origin.type === 'session').length,
    sourceScheduled: selections.filter(row => row.origin.type === 'scheduledWorkout').length,
    sourcePrograms: value.source.programCount,
    selected: status('selected'), blocked: status('blocked'), excludedByCoach: status('excluded_by_coach'),
    outsidePeriod: status('outside_period'), alreadyImported: status('already_imported'), representedBySession: status('represented_by_session'),
    linkedPrograms: selections.filter(row => row.origin.type === 'program' && ready.has(row.groupKey)).length,
    autoCreatedPrograms: selections.filter(row => row.origin.type === 'defaultProgram' && ready.has(row.groupKey)).length,
    catalogueMatches: exerciseMappings.filter(row => row.kind === 'catalogue').length,
    customExercises: operations.filter(row => row.kind === 'custom_exercise' && row.validation === 'ready').length,
    convertedSets, omittedMeasures,
  };
  return { preview, readiness };
}

const unique = (items: readonly string[]) => new Set(items).size === items.length;
function inOrder(rows: { sourceKey: string; position: number }[]): boolean {
  return unique(rows.map(row => row.sourceKey)) && rows.every((row, i) => !i || row.position > rows[i - 1].position);
}

const expectedOrigin = {
  historical_session: 'session', standalone_scheduled: 'scheduledWorkout', custom_exercise: 'exercise',
} as const;

export async function validateMezfitImportPlan(value: unknown): Promise<boolean> {
  // Check the same immutable snapshot before awaiting digest computations.
  const plan = jsonSnapshot(value, 8_388_608);
  if (!planRule(plan)) return false;
  if (plan.scope.fromDate > plan.scope.throughDate) return false;
  const targets = new Map(plan.targetBindings.map(row => [row.contextKey, row]));
  const mappings = new Map(plan.exerciseMappings.map(row => [row.mappingKey, row]));
  const groups = new Map(plan.selections.map(row => [row.groupKey, row]));
  const operations = new Map(plan.operations.map(row => [row.operationKey, row]));
  if (targets.size !== plan.targetBindings.length || mappings.size !== plan.exerciseMappings.length
    || groups.size !== plan.selections.length || operations.size !== plan.operations.length
    || !unique(plan.targetBindings.map(row => row.subjectSourceKey))) return false;
  const bySubject = new Map(plan.targetBindings.map(row => [row.subjectSourceKey, row]));
  const skippedStatuses = new Set(['outside_period', 'represented_by_session', 'already_imported', 'excluded_by_coach']);
  const { sourceApp, formatFamily, datasetKey } = plan.source;

  if (!plan.issues.every(issue => issue.groupRef === null || groups.has(issue.groupRef) || mappings.has(issue.groupRef))) return false;

  for (const mapping of plan.exerciseMappings) {
    if (!bySubject.has(mapping.subjectKey)) return false;
    if (mapping.kind === 'proposed_custom' && groups.get(mapping.mappingKey)?.origin.type !== 'exercise') return false;
  }
  const metadataParents = new Set<string>();
  for (const operation of plan.operations) {
    const target = targets.get(operation.targetBindingRef);
    const { subjectSourceKey } = operation.origin;
    if (!target || subjectSourceKey !== target.subjectSourceKey
      || (operation.validation === 'ready' && target.kind === 'unresolved')
      || !unique(operation.dependencyKeys)) return false;
    for (const dependency of operation.dependencyKeys) {
      const parent = groups.get(dependency);
      if (!parent || parent.origin.subjectSourceKey !== subjectSourceKey || dependency === operation.operationKey) return false;
      if (operation.validation === 'ready' && parent.status !== 'selected' && parent.status !== 'already_imported') return false;
    }
    const group = groups.get(operation.operationKey);
    if (operation.kind === 'provenance_metadata') {
      const [parentKey] = operation.dependencyKeys;
      const parent = operations.get(parentKey);
      if (group || operation.dependencyKeys.length !== 1 || operation.validation !== 'ready'
        || operation.losses.length || !parent || parent.kind === 'provenance_metadata' || parent.kind === 'custom_exercise'
        || metadataParents.has(parentKey) || canonical(parent.origin) !== canonical(operation.origin)
        || await hash(['mig05-provenance-v1', parentKey]) !== operation.operationKey) return false;
      metadataParents.add(parentKey);
      continue;
    }
    if (!group || canonical(group.origin) !== canonical(operation.origin)
      || canonical(group.dependencyKeys) !== canonical(operation.dependencyKeys)
      || group.status !== (operation.validation === 'ready' ? 'selected' : 'blocked')) return false;

    const allowedDependencies = new Set<string>();
    function checkExercises(rows: { sourceKey: string; position: number; exerciseSourceKey: string; mappingRef: string;
      sets: { sourceKey: string; position: number; metrics?: import('./contracts').MappedMetrics }[] }[]): boolean {
      return inOrder(rows) && rows.every(row => {
        const mapping = mappings.get(row.mappingRef);
        if (!mapping || mapping.exerciseSourceKey !== row.exerciseSourceKey || mapping.subjectKey !== subjectSourceKey
          || !inOrder(row.sets)) return false;
        if (mapping.kind === 'proposed_custom') allowedDependencies.add(mapping.mappingKey);
        const type = mapping.kind === 'catalogue' ? mapping.target.trackingType
          : mapping.kind === 'proposed_custom' ? mapping.definition.trackingType : null;
        return (operation.validation === 'blocked' || type !== null) && row.sets.every(set => !set.metrics
          || canonical(mapMetrics(set.metrics.original, type, () => {})) === canonical(set.metrics));
      });
    }
    if (operation.kind === 'program_structure') {
      const synthetic = operation.origin.type === 'defaultProgram';
      if ((!synthetic && operation.origin.type !== 'program') || synthetic !== (operation.activation === 'proposed_active')
        || !inOrder(operation.phases) || !inOrder(operation.days)
        || (synthetic && operation.validation === 'ready' && (operation.phases.length !== 1 || operation.days.length !== 1))) return false;
      const phases = new Set(operation.phases.map(row => row.sourceKey));
      for (const day of operation.days) {
        if (!checkExercises(day.exercises) || (operation.validation === 'ready'
          && (day.phaseRef.state === 'unknown' || day.phaseRef.state === 'linked' && !phases.has(day.phaseRef.sourceKey)))) return false;
      }
    } else if (operation.origin.type !== expectedOrigin[operation.kind]) {
      return false;
    } else if (operation.kind === 'custom_exercise') {
      const mapping = mappings.get(operation.mappingRef);
      if (operation.mappingRef !== operation.operationKey || mapping?.kind !== 'proposed_custom'
        || mapping.subjectKey !== subjectSourceKey || mapping.exerciseSourceKey !== operation.origin.sourceKey
        || canonical(mapping.definition) !== canonical(operation.definition)) return false;
    } else {
      const { timing, programOperationRef } = operation;
      const ready = operation.validation === 'ready';
      if (ready && (!timing?.proposedStartUtc || (operation.programRef.state === 'linked' && !programOperationRef)
        || (operation.programDayRef.state === 'linked' && !programOperationRef))) return false;
      const exact = timing && exactStart(timing.original);
      if (timing && (timing.businessDate < plan.scope.fromDate || timing.businessDate > plan.scope.throughDate
        || businessDate(timing.original).date !== timing.businessDate
        || (!timing.importTimeInferred && (exact == null ? timing.proposedStartUtc !== null
          : Date.parse(timing.proposedStartUtc ?? '') !== exact))
        || timing.importTimeInferred !== (timing.allocationEndsAtUtc !== null)
        || (timing.allocationEndsAtUtc !== null && (!timing.proposedStartUtc
          || Date.parse(timing.allocationEndsAtUtc) - Date.parse(timing.proposedStartUtc) !== 3_600_000
          || timing.original.precision !== 'date' || !timing.original.timeZone)))) return false;
      let program: ImportOperation | undefined;
      if (programOperationRef) {
        const parent = groups.get(programOperationRef);
        program = operations.get(programOperationRef);
        if (parent?.origin.type !== 'program' || (operation.programRef.state === 'linked'
          && parent.origin.sourceKey !== operation.programRef.sourceKey)) return false;
        allowedDependencies.add(programOperationRef);
      }
      const sourcePlan = operation.kind === 'historical_session' ? operation.frozenPlan : operation.plan;
      if (sourcePlan.state === 'present') {
        if (!checkExercises(sourcePlan.exercises)) return false;
        if (ready && sourcePlan.exercises.some(row => row.sets.some(set => set.metrics.converted === null))) return false;
        if (ready && program?.kind === 'program_structure') {
          const dayRef = operation.programDayRef;
          const validDays = program.days.filter(day => dayRef.state !== 'linked' || day.sourceKey === dayRef.sourceKey);
          if (!validDays.length && dayRef.state === 'linked') return false;
          for (const row of sourcePlan.exercises) {
            const parentRef = row.sourceProgramExerciseRef;
            const parents = validDays.flatMap(day => day.exercises).filter(exercise => exercise.exerciseSourceKey === row.exerciseSourceKey
              && (parentRef.state !== 'linked' || exercise.sourceKey === parentRef.sourceKey));
            if (parentRef.state === 'linked' && !parents.length) return false;
            if (row.sets.some(set => {
              const ref = set.sourceProgramSetRef;
              return ref.state === 'linked' && !parents.some(parent => parent.sets.some(item => item.sourceKey === ref.sourceKey));
            })) return false;
          }
        } else if (ready && !programOperationRef && sourcePlan.exercises.some(row => row.sourceProgramExerciseRef.state === 'linked'
          || row.sets.some(set => set.sourceProgramSetRef.state === 'linked'))) return false;
      }
      if (operation.kind === 'historical_session') {
        if (!checkExercises(operation.fact) || (ready && operation.lifecycle !== 'completed')) return false;
        const frozen = new Map<string, string>();
        if (sourcePlan.state === 'present') {
          for (const exercise of sourcePlan.exercises) for (const set of exercise.sets) frozen.set(set.sourceKey, exercise.exerciseSourceKey);
          if (frozen.size !== planSets(sourcePlan).length) return false;
        }
        if (ready && operation.fact.some(row => row.sets.some(set => set.metrics.converted === null
          || set.setStatus === 'unknown' || (set.rpe !== null && (!Number.isInteger(set.rpe) || set.rpe < 1 || set.rpe > 10))
          || set.planSetRef.state === 'linked' && frozen.get(set.planSetRef.sourceKey) !== row.exerciseSourceKey))) return false;
      } else if (ready && sourcePlan.state === 'unknown') return false;
    }
    if (canonical([...allowedDependencies].sort(compare)) !== canonical(operation.dependencyKeys)) return false;
  }

  for (const group of plan.selections) {
    const { type, sourceKey, subjectSourceKey } = group.origin;
    const key = await hash(['mig05-key-v1', sourceApp, formatFamily, datasetKey,
      bySubject.get(subjectSourceKey ?? '')?.contextKey ?? null, subjectSourceKey, type, sourceKey]);
    if (key !== group.groupKey || !unique(group.dependencyKeys) || (!operations.has(key) && group.dependencyKeys.length)
      || (skippedStatuses.has(group.status) && operations.has(key)) || (group.status === 'selected' && !operations.has(key))
      || (group.status === 'selected' && type !== 'exercise' && !metadataParents.has(key))
      || (group.status === 'blocked' && !group.reasons.length)) return false;
  }
  for (const mapping of plan.exerciseMappings) {
    if (mapping.mappingKey !== await hash(['mig05-key-v1', sourceApp, formatFamily, datasetKey,
      bySubject.get(mapping.subjectKey)?.contextKey ?? null, mapping.subjectKey, 'exercise', mapping.exerciseSourceKey])) return false;
  }

  if (new Set(plan.selections.filter(row => row.origin.type === 'program').map(row => row.origin.sourceKey)).size
    > plan.source.programCount) return false;
  const { preview, readiness } = summarize(plan);
  if (canonical(plan.preview) !== canonical(preview) || plan.readiness !== readiness) return false;
  const { planId, ...body } = plan;
  return await hash(body) === planId;
}
