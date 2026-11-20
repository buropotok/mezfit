import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isSourceImportPackage, requiredSourceIssues } from '../worker/processor/source-package/validate';
import { PROCESSOR_VERSION, SOURCE_PACKAGE_RESULT_LIMIT } from '../processor-protocol.mjs';
import { buildMezfitImportPlan, validateMezfitImportPlan } from './index';

const none = () => ({ state: 'none' });
const unknown = () => ({ state: 'unknown' });
const link = sourceKey => ({ state: 'linked', sourceKey });
const attrs = () => ({ sourceAttributes: [] });
const local = (localDate, timeZone = 'Europe/Moscow') => ({
  localDate, timeZone, precision: 'date', startedAtUtc: null, completedAtUtc: null,
});
const exact = (localDate, startedAtUtc, completedAtUtc, timeZone = 'Europe/Moscow') => ({
  localDate, timeZone, precision: 'instant', startedAtUtc, completedAtUtc,
});
const metrics = (parts = {}) => ({ weight: null, duration: null, distance: null, reps: null, ...parts });
const unit = (value, unit) => ({ value, unit });
const fact = (id, measures, planSetRef = none()) => ({
  sourceKey: id, position: 0, planSetRef, sourceSetType: null, sourceSetLabel: null,
  metrics: measures, setStatus: 'completed', rpe: 7, comment: null, ...attrs(),
});
const move = (id, exerciseSourceKey, sets) => ({ sourceKey: id, exerciseSourceKey, position: 0, notes: null, sets });
const foreign = (id, sourceName, trackingHint) => ({
  sourceKey: id, sourceName, trackingHint, equipment: null, movementType: null,
  aliases: [], bodyPart: null, primaryMuscles: [], ...attrs(),
});
const session = (id, date, performedExercises = []) => ({
  sourceKey: id, subjectRef: link('person'), programRef: none(), scheduledWorkoutRef: none(),
  name: 'Тренировка', timing: local(date), completionState: 'completed', frozenPlan: { state: 'absent' },
  performedExercises, ...attrs(),
});
const appointment = (id, date) => ({
  sourceKey: id, subjectRef: link('person'), programRef: none(), programDayRef: none(), name: 'Тренировка',
  timing: local(date), plan: { state: 'absent' }, ...attrs(),
});
const targetMove = { id: '0001', name: 'Жим', trackingType: 'weight_reps', equipment: 'Штанга', movementType: 'Жим' };
const config = () => ({
  datasetKey: 'stable-diary', policyVersion: 'mig-05.v1',
  period: { fromDate: '2026-01-01', throughDate: '2026-12-31', selectionTimeZone: 'Europe/Moscow' },
  evaluatedAtUtc: '2027-01-02T10:00:00.000Z',
  targetSnapshot: [{ kind: 'provisional_imported_client', subjectSourceKey: 'person', contextKey: 'private-context' }],
  catalogueSnapshot: [targetMove], mappingSnapshot: [], occupancySnapshot: [], existingImportsSnapshot: [], excludedGroups: [],
});
const source = () => ({
  kind: 'mezfit.source-import', schemaVersion: 1,
  provenance: { sourceApp: 'fixture-app', formatFamily: 'fixture-diary', formatVersion: '1', adapterId: 'fixture',
    adapterVersion: '1.0.0', inputSha256: 'a'.repeat(64), exportKind: 'full_backup' },
  coverage: { subjects: 'complete', sourceExercises: 'complete', programs: 'complete', scheduledWorkouts: 'complete',
    sessions: 'complete', measures: 'partial' },
  subjects: [{ sourceKey: 'person', displayName: 'Атлет', sourceContainerKeys: [], ...attrs() }],
  sourceExercises: [
    { ...foreign('press', 'Жим', 'weight_reps'), equipment: 'Штанга', movementType: 'Жим' },
    foreign('hold', 'Удержание', 'time'),
  ],
  programs: [], scheduledWorkouts: [], sessions: [], issues: [],
  omittedData: [{ category: 'measures', reason: 'unsupported_target', count: 3 }],
});

function example() {
  const pkg = source();
  pkg.programs.push({
    sourceKey: 'program', subjectRef: link('person'), name: 'Программа 2022',
    sourceAttributes: [{ kind: 'string', name: 'source_creation_date', value: '2022-01-01' }],
    phases: [{ sourceKey: 'phase', name: 'Фаза', position: 0, ...attrs() }],
    days: [{ sourceKey: 'day', phaseRef: link('phase'), name: 'День', position: 0, ...attrs(),
      exercises: [{ ...move('program-move', 'press', [{ sourceKey: 'structural-set', position: 0, sourceSetType: 'dropset',
        sourceSetLabel: 'normal', comment: 'Техника', sourceAttributes: [
          { name: 'source_planned_weight', kind: 'number', value: 95, unit: 'kg' },
        ] }]), ...attrs() }] },
    { sourceKey: 'other-day', phaseRef: link('phase'), name: 'Другой день', position: 1, ...attrs(),
      exercises: [{ ...move('other-program-move', 'hold', []), ...attrs() }] }],
  });
  pkg.programs.push({ sourceKey: 'unused', subjectRef: link('person'), name: 'Программа 2026', phases: [], days: [], ...attrs() });
  const template = { programRef: link('program'), programDayRef: link('day') };
  const plan = (id, value) => ({ state: 'present', exercises: [{
    sourceKey: id + '-move', exerciseSourceKey: 'press', position: 0, sourceProgramExerciseRef: link('program-move'),
    sets: [{ sourceKey: id + '-set', position: 0, sourceSetType: null, sourceProgramSetRef: link('structural-set'),
      metrics: metrics({ weight: unit(value, 'kg'), reps: 10 }) }],
  }] });
  pkg.scheduledWorkouts.push(
    { ...appointment('used-slot', '2026-01-01'), ...template, plan: plan('used', 80) },
    { ...appointment('standalone', '2026-12-31'), ...template, plan: plan('future', 77) },
  );
  pkg.sessions.push(
    { ...session('planned-history', '2026-01-01', [
      move('press-fact', 'press', [fact('press-set', metrics({ weight: unit(100, 'lb'), reps: 8 }), link('frozen-set'))]),
    ]), programRef: link('program'), scheduledWorkoutRef: link('used-slot'), frozenPlan: plan('frozen', 82) },
    session('adhoc-history', '2026-12-31', [
      move('hold-fact', 'hold', [fact('hold-set', metrics({ duration: unit(2, 'min') }))]),
    ]),
  );
  return pkg;
}

const reissue = pkg => { pkg.issues = requiredSourceIssues(pkg); return pkg; };
const build = (pkg, settings = config()) => buildMezfitImportPlan(reissue(pkg), settings);
const group = (plan, key, type) => plan.selections.find(row => row.origin.sourceKey === key && (!type || row.origin.type === type));
const op = (plan, key) => plan.operations.find(row => row.origin.sourceKey === key && row.kind !== 'provenance_metadata');
const issue = (plan, code) => plan.issues.some(row => row.code === code);

describe('MIG-05 business mapping', () => {
  it('builds two sessions, one standalone schedule and one entire old program', async () => {
    const plan = await build(example());
    expect(await validateMezfitImportPlan(plan)).toBe(true);
    expect(plan.preview).toMatchObject({ sourceSessions: 2, sourceScheduled: 2, sourcePrograms: 2,
      selected: 5, linkedPrograms: 1, representedBySession: 1, catalogueMatches: 1, customExercises: 1,
      convertedSets: 4, omittedMeasures: 3 });
    expect(plan.readiness).toBe('requires_decisions');
    expect(group(plan, 'used-slot').status).toBe('represented_by_session');
    expect(group(plan, 'unused')).toBeUndefined();
    expect(op(plan, 'program').days.map(day => day.sourceKey)).toEqual(['day', 'other-day']);
    expect(op(plan, 'program').days[0].exercises[0].sets[0]).toEqual({
      sourceKey: 'structural-set', position: 0, sourceSetType: 'dropset', sourceSetLabel: 'normal', comment: 'Техника',
    });
    expect(op(plan, 'program').losses).toContainEqual(expect.objectContaining({
      code: 'SOURCE_PROGRAM_NUMERIC_PRESCRIPTION', attribute: expect.objectContaining({ value: 95, unit: 'kg' }),
    }));
    expect(op(plan, 'standalone')).toMatchObject({ missed: 'undetermined', endsAtUtc: null });
    expect(op(plan, 'standalone').plan.exercises[0].sets[0].metrics.converted.weightKg).toBe(77);
    expect(op(plan, 'planned-history').frozenPlan.exercises[0].sets[0].metrics.converted.weightKg).toBe(82);
    expect(op(plan, 'planned-history').fact[0].sets[0].metrics.converted.weightKg).toBeCloseTo(45.359237);
    expect(op(plan, 'adhoc-history')).toMatchObject({
      programOperationRef: null, occurrenceRef: none(), frozenPlan: { state: 'absent' }, imported: true, lifecycle: 'completed',
    });
    expect(op(plan, 'adhoc-history').fact[0].sets[0].metrics.converted.durationSeconds).toBe(120);
    expect(op(plan, 'program').days[1].exercises[0].mappingRef).toBe(op(plan, 'adhoc-history').fact[0].mappingRef);
    expect(op(plan, 'hold').definition.requiresPostImportReconciliation).toBe(true);
    expect(plan.operations.filter(row => row.kind === 'provenance_metadata')).toHaveLength(4);
  });

  it('filters four years by inclusive source business date and does not shift a fixed period', async () => {
    const pkg = example();
    for (const year of [2023, 2024, 2025]) {
      pkg.sessions.push(session('history-' + year, year + '-03-20'));
      pkg.scheduledWorkouts.push(appointment('schedule-' + year, year + '-04-23'));
    }
    pkg.sessions[0].timing = exact('2026-01-01', '2025-12-31T21:00:00Z', '2025-12-31T22:00:00Z');
    const first = await build(pkg);
    expect(first.preview.outsidePeriod).toBe(6);
    expect(op(first, 'planned-history').timing.businessDate).toBe('2026-01-01');
    expect(op(first, 'standalone').timing.businessDate).toBe('2026-12-31');
    expect((await build(pkg)).planId).toBe(first.planId);
  });

  it('deduplicates globally even when the linked session is outside the selected range', async () => {
    const pkg = example();
    pkg.sessions[0].timing = local('2025-12-31');
    const plan = await build(pkg);
    expect(group(plan, 'planned-history').status).toBe('outside_period');
    expect(group(plan, 'used-slot').status).toBe('represented_by_session');
    expect(op(plan, 'used-slot')).toBeUndefined();
  });

  it('imports each linked session when the appointment is outside the period', async () => {
    const pkg = example();
    pkg.scheduledWorkouts[0].timing = local('2025-12-31');
    pkg.sessions.push({ ...session('extra-session', '2026-01-02'), programRef: link('program'), scheduledWorkoutRef: link('used-slot') });
    const plan = await build(pkg);
    expect(plan.operations.filter(row => row.kind === 'historical_session')).toHaveLength(3);
    expect(op(plan, 'used-slot')).toBeUndefined();
  });

  it('uses established transitive program/day evidence and refuses contradictory absence', async () => {
    const pkg = example();
    pkg.sessions[0].programRef = unknown();
    const first = await build(pkg);
    expect(op(first, 'planned-history').programOperationRef).toBe(group(first, 'program').groupKey);
    pkg.sessions[0].programRef = none();
    const second = await build(pkg);
    expect(group(second, 'planned-history').reasons).toContain('CONFLICTING_PROGRAM_LINK');
  });

  it.each(['partial', 'unknown', 'not_in_export'])('blocks standalone schedule with %s history coverage', async completeness => {
    const pkg = source();
    pkg.coverage.sessions = completeness;
    pkg.scheduledWorkouts.push(appointment('standalone', '2026-12-31'));
    expect(group(await build(pkg), 'standalone').reasons).toContain('SESSION_LINK_UNCERTAIN');
  });

  it('reports dangling links, unknown days and incomplete lifecycle without inventing history', async () => {
    const pkg = example();
    pkg.sessions[0].scheduledWorkoutRef = link('missing-slot');
    pkg.sessions[1].timing = { ...local(null), precision: 'unknown' };
    pkg.sessions[1].completionState = 'in_progress';
    const plan = await build(pkg);
    expect(group(plan, 'planned-history').reasons).toContain('UNRESOLVED_SOURCE_LINK');
    expect(group(plan, 'adhoc-history').reasons).toEqual(expect.arrayContaining(['UNKNOWN_DATE', 'SESSION_NOT_COMPLETED']));
    expect(op(plan, 'adhoc-history').lifecycle).toBe('in_progress');
    expect(group(plan, 'standalone').reasons).toContain('SESSION_LINK_UNCERTAIN');
  });

  it('compares explicit links instead of identical names and dates', async () => {
    const pkg = source();
    pkg.scheduledWorkouts.push(appointment('standalone', '2026-04-05'));
    pkg.sessions.push(session('adhoc', '2026-04-05'));
    const plan = await build(pkg);
    expect(group(plan, 'standalone').status).toBe('selected');
    expect(group(plan, 'adhoc').status).toBe('selected');
  });

  it('builds a separate one-day active program using only the latest known structure', async () => {
    const pkg = source();
    pkg.sessions.push(session('earlier', '2026-01-03'), session('latest', '2026-06-01',
      [move('hold-fact', 'hold', [fact('hold-set', metrics({ duration: unit(45, 'sec') }))])]));
    const plan = await build(pkg);
    expect(plan.readiness).toBe('ready_for_review');
    expect(op(plan, 'person')).toMatchObject({ activation: 'proposed_active', days: [{ sourceKey: 'latest' }] });
    expect(op(plan, 'person').phases).toHaveLength(1);
    expect(op(plan, 'person').days[0].exercises[0].sets[0]).not.toHaveProperty('metrics');
    expect(op(plan, 'latest').programOperationRef).toBeNull();
    expect(op(plan, 'earlier').programOperationRef).toBeNull();
  });

  it('blocks only the default program when order within the most recent date is ambiguous', async () => {
    const pkg = source();
    pkg.sessions.push(session('one', '2026-03-14'), session('two', '2026-03-14'));
    const plan = await build(pkg);
    expect(group(plan, 'person').reasons).toContain('LAST_SESSION_UNCERTAIN');
    expect(group(plan, 'one').status).toBe('selected');
    expect(group(plan, 'two').status).toBe('selected');
  });

  it('does not infer program absence from an incomplete catalogue or unknown link', async () => {
    const pkg = source();
    pkg.coverage.programs = 'not_in_export';
    pkg.sessions.push({ ...session('first', '2026-03-14'), programRef: unknown() }, session('second', '2026-03-15'));
    const plan = await build(pkg);
    expect(group(plan, 'person').reasons).toContain('PROGRAM_PRESENCE_UNKNOWN');
    expect(plan.preview.autoCreatedPrograms).toBe(0);
    expect(group(plan, 'second').status).toBe('selected');
  });

  it('preserves independently selected programs and reports conflicts with an active program', async () => {
    const pkg = example();
    pkg.sessions[1].programRef = link('unused');
    expect((await build(pkg)).preview.linkedPrograms).toBe(2);
    const options = config();
    options.targetSnapshot[0] = { ...options.targetSnapshot[0], kind: 'existing_client', activeProgram: 'present' };
    const plan = await build(example(), options);
    expect(group(plan, 'program').reasons).toContain('ACTIVE_PROGRAM_CONFLICT');
    expect(group(plan, 'adhoc-history').status).toBe('selected');
    expect(group(plan, 'planned-history').reasons).toContain('DEPENDENCY_BLOCKED');
  });

  it('proposes a custom exercise for ambiguous matches without requiring a manual selection', async () => {
    const options = config();
    options.catalogueSnapshot.push({ ...targetMove, id: '0002' });
    const plan = await build(example(), options);
    expect(issue(plan, 'CATALOGUE_AMBIGUOUS')).toBe(true);
    expect(plan.exerciseMappings.find(row => row.exerciseSourceKey === 'press').kind).toBe('proposed_custom');
    expect(group(plan, 'planned-history').status).toBe('selected');
  });

  it('honours a trusted registry entry and rejects stale or incompatible targets', async () => {
    const options = config();
    const initial = await build(example(), options);
    const mapping = initial.exerciseMappings.find(row => row.exerciseSourceKey === 'press');
    options.catalogueSnapshot.push({ ...targetMove, id: '0002' });
    options.mappingSnapshot.push({ exerciseKey: mapping.mappingKey, catalogueId: '0002' });
    const matched = await build(example(), options);
    expect(matched.exerciseMappings.find(row => row.exerciseSourceKey === 'press')).toMatchObject({
      kind: 'catalogue', evidence: 'approved_registry', target: { id: '0002' },
    });
    options.mappingSnapshot[0].catalogueId = 'missing';
    expect(issue(await build(example(), options), 'INVALID_APPROVED_MAPPING')).toBe(true);
  });

  it('blocks incomplete exercise definitions, without losing an unrelated workout or its losses', async () => {
    const pkg = example();
    pkg.sourceExercises[0].trackingHint = null;
    const plan = await build(pkg);
    expect(plan.readiness).toBe('requires_decisions');
    expect(group(plan, 'program').status).toBe('blocked');
    expect(group(plan, 'planned-history').reasons).toContain('CUSTOM_EXERCISE_DATA_MISSING');
    expect(group(plan, 'adhoc-history').status).toBe('selected');
    expect(plan.preview.omittedMeasures).toBe(3);
  });

  it('scopes identities to the source dataset and subject', async () => {
    const options = config();
    const first = await build(example(), options);
    options.datasetKey = 'other-diary';
    const second = await build(example(), options);
    expect(second.exerciseMappings.map(row => row.mappingKey)).not.toEqual(first.exerciseMappings.map(row => row.mappingKey));
    const pkg = example();
    pkg.subjects.push({ ...pkg.subjects[0], sourceKey: 'second-person' });
    pkg.sessions[1].subjectRef = link('second-person');
    options.targetSnapshot.push({ kind: 'provisional_imported_client', subjectSourceKey: 'second-person', contextKey: 'second-context' });
    const third = await build(pkg, options);
    const keys = third.exerciseMappings.filter(row => row.exerciseSourceKey === 'hold').map(row => row.mappingKey);
    expect(new Set(keys).size).toBe(2);
  });
});

describe('MIG-05 measurement and time inference', () => {
  it.each([
    ['weight_reps', 'weight', 'weightKg', 'kg', 2], ['weight_reps', 'weight', 'weightKg', 'g', 0.002],
    ['weight_reps', 'weight', 'weightKg', 'lb', 0.90718474], ['weight_reps', 'weight', 'weightKg', 'lbs', 0.90718474],
    ['time', 'duration', 'durationSeconds', 's', 2], ['time', 'duration', 'durationSeconds', 'sec', 2],
    ['time', 'duration', 'durationSeconds', 'ms', 0.002], ['time', 'duration', 'durationSeconds', 'min', 120],
    ['time', 'duration', 'durationSeconds', 'h', 7200],
    ['time_distance', 'distance', 'distanceMeters', 'm', 2], ['time_distance', 'distance', 'distanceMeters', 'km', 2000],
    ['time_distance', 'distance', 'distanceMeters', 'cm', 0.02], ['time_distance', 'distance', 'distanceMeters', 'mi', 3218.688],
    ['time_distance', 'distance', 'distanceMeters', 'ft', 0.6096],
  ])('normalizes %s %s from %s (%s)', async (type, sourceField, field, unitName, expected) => {
    const pkg = source();
    pkg.sourceExercises.push(foreign('metric', 'Упражнение', type));
    pkg.sessions.push(session('measured', '2026-03-01', [
      move('move', 'metric', [fact('measured-set', metrics({ [sourceField]: unit(2, unitName) })),
        { ...fact('zero', metrics({ [sourceField]: unit(0, unitName) })), position: 1 }]),
    ]));
    const sets = op(await build(pkg), 'measured').fact[0].sets;
    expect(sets[0].metrics.converted[field]).toBeCloseTo(expected, 10);
    expect(sets[0].metrics.original[sourceField]).toEqual(unit(2, unitName));
    expect(sets[1].metrics.converted[field]).toBe(0);
    expect(sets[1].metrics.converted.reps).toBeNull();
  });

  it('reports unsupported raw measures and maintains independent readiness and omission counts', async () => {
    const pkg = example();
    pkg.sessions[1].performedExercises[0].sets[0].metrics.duration.unit = 'beats';
    const plan = await build(pkg);
    expect(group(plan, 'adhoc-history').reasons).toContain('UNSUPPORTED_UNIT');
    expect(op(plan, 'adhoc-history').fact[0].sets[0].metrics).toMatchObject({
      original: { duration: { value: 2, unit: 'beats' } }, converted: null,
    });
    expect(group(plan, 'planned-history').status).toBe('selected');
    expect(plan.preview).toMatchObject({ blocked: 1, omittedMeasures: 3 });
  });

  it('skips occupied times across subjects and uses the local offset through DST', async () => {
    const pkg = source();
    const day = '2026-03-29';
    pkg.subjects.push({ ...pkg.subjects[0], sourceKey: 'second-person', displayName: 'Б' });
    pkg.sessions.push(
      { ...session('a', day), timing: local(day, 'Europe/Berlin') },
      { ...session('b', day), timing: local(day, 'Europe/Berlin'), subjectRef: link('second-person') },
    );
    const options = config();
    options.targetSnapshot.push({ kind: 'provisional_imported_client', subjectSourceKey: 'second-person', contextKey: 'second-context' });
    options.occupancySnapshot.push({ startsAtUtc: '2026-03-29T05:45:00Z', endsAtUtc: '2026-03-29T07:00:00Z' });
    const plan = await build(pkg, options);
    expect(op(plan, 'a').timing).toMatchObject({ proposedStartUtc: '2026-03-29T07:00:00.000Z', importTimeInferred: true });
    expect(op(plan, 'b').timing.proposedStartUtc).toBe('2026-03-29T08:00:00.000Z');
  });

  it('blocks exhausted slots, unknown clocks and a missing occupancy snapshot', async () => {
    const pkg = source();
    pkg.sessions.push(session('no-room', '2026-03-29'), { ...session('no-zone', '2026-03-29'), timing: local('2026-03-29', null) });
    const options = config();
    options.occupancySnapshot = [{ startsAtUtc: '2026-03-29T05:00:00Z', endsAtUtc: '2026-03-29T21:00:00Z' }];
    const plan = await build(pkg, options);
    expect(group(plan, 'no-room').reasons).toContain('NO_FREE_SLOT');
    expect(group(plan, 'no-zone').reasons).toContain('UNKNOWN_TIME_ZONE');
    options.occupancySnapshot = null;
    expect(group(await build(pkg, options), 'no-room').reasons).toContain('OCCUPANCY_UNRESOLVED');
  });

  it('does not treat a source completion timestamp or allocation end as the scheduled end', async () => {
    const pkg = example();
    pkg.scheduledWorkouts[1].timing = exact('2026-12-31', '2026-12-31T12:00:00Z', '2026-12-31T13:00:00Z');
    const plan = await build(pkg);
    expect(op(plan, 'standalone')).toMatchObject({ missed: 'undetermined', endsAtUtc: null });
    expect(issue(plan, 'UNKNOWN_SCHEDULE_END')).toBe(true);
  });
});

describe('MIG-05 isolated planning boundary', () => {
  it('pins hashes against reordered inputs and changes them when evidence changes', async () => {
    const pkg = example();
    const options = config();
    const first = await build(pkg, options);
    pkg.sessions.reverse();
    pkg.programs.reverse();
    pkg.programs[1].days.reverse();
    pkg.sourceExercises.reverse();
    expect(await build(pkg, options)).toEqual(first);
    options.occupancySnapshot.push({ startsAtUtc: '2026-01-01T05:00:00Z', endsAtUtc: '2026-01-01T06:00:00Z' });
    const newer = await build(pkg, options);
    expect(newer.planId).not.toBe(first.planId);
    expect(group(newer, 'planned-history').groupKey).toBe(group(first, 'planned-history').groupKey);
  });

  it('skips exact import identities across exports and reports explicit group exclusion', async () => {
    const pkg = example();
    const first = await build(pkg);
    const options = config();
    options.existingImportsSnapshot.push(group(first, 'planned-history').groupKey);
    options.excludedGroups.push(group(first, 'adhoc-history').groupKey);
    pkg.provenance.inputSha256 = 'b'.repeat(64);
    const plan = await build(pkg, options);
    expect(group(plan, 'planned-history').status).toBe('already_imported');
    expect(group(plan, 'adhoc-history').status).toBe('excluded_by_coach');
    expect(op(plan, 'planned-history')).toBeUndefined();
    expect(plan.preview).toMatchObject({ alreadyImported: 1, excludedByCoach: 1, representedBySession: 1 });
  });

  it('fails closed for cycles, cross-subject links, sparse/deep inputs and unknown snapshot keys', async () => {
    const pkg = example();
    const settings = config();
    await expect(buildMezfitImportPlan(pkg, settings)).rejects.toThrow('MIG05_INVALID_SOURCE_PACKAGE');
    reissue(pkg);
    await expect(buildMezfitImportPlan(pkg, { ...settings, realmId: 'private' })).rejects.toThrow('MIG05_INVALID_PLANNING_INPUT');
    const getter = Object.defineProperty({ ...settings }, 'period', { enumerable: true, get: () => { throw new Error('secret'); } });
    await expect(buildMezfitImportPlan(pkg, getter)).rejects.toThrow('MIG05_INVALID_PLANNING_INPUT');
    const cycle = { ...pkg }; cycle.cycle = cycle;
    await expect(buildMezfitImportPlan(cycle, settings)).rejects.toThrow('MIG05_INVALID_SOURCE_PACKAGE');
    await expect(buildMezfitImportPlan({ ...pkg, sessions: Array(3) }, settings)).rejects.toThrow('MIG05_INVALID_SOURCE_PACKAGE');
    const deep = Array.from({ length: 24 }).reduce(tree => ({ nested: tree }), {});
    await expect(buildMezfitImportPlan({ ...pkg, deep }, settings)).rejects.toThrow('MIG05_INVALID_SOURCE_PACKAGE');
    pkg.subjects.push({ ...pkg.subjects[0], sourceKey: 'other' });
    pkg.sessions[0].subjectRef = link('other');
    await expect(buildMezfitImportPlan(pkg, settings)).rejects.toThrow('MIG05_INVALID_SOURCE_PACKAGE');
  });

  it('rejects forged operation references and numeric program PLAN even with a recomputed digest', async () => {
    const plan = await build(example());
    const canonical = value => {
      if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
      if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
        .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
      return JSON.stringify(value);
    };
    const resign = value => {
      const { planId: _planId, ...body } = value;
      value.planId = createHash('sha256').update(canonical(body)).digest('hex');
      return value;
    };
    const forged = structuredClone(plan);
    op(forged, 'adhoc-history').fact[0].mappingRef = 'c'.repeat(64);
    expect(await validateMezfitImportPlan(resign(forged))).toBe(false);
    const numeric = structuredClone(plan);
    op(numeric, 'program').days[0].exercises[0].sets[0].plannedWeightKg = 20;
    expect(await validateMezfitImportPlan(resign(numeric))).toBe(false);
    expect(await validateMezfitImportPlan({ ...plan, planId: 'c'.repeat(64) })).toBe(false);
  });

  it('keeps the MIG-04 boundary intact and planning independent of runtime storage or transport', async () => {
    const pkg = reissue(example());
    const before = structuredClone(pkg);
    expect(isSourceImportPackage(pkg)).toBe(true);
    expect(PROCESSOR_VERSION).toBe('v1');
    expect(SOURCE_PACKAGE_RESULT_LIMIT).toBe(65536);
    await buildMezfitImportPlan(pkg, config());
    expect(pkg).toEqual(before);
    const dir = new URL('./', import.meta.url);
    for (const name of readdirSync(dir).filter(name => name.endsWith('.ts'))) {
      const code = readFileSync(new URL(name, dir), 'utf8');
      expect(code).not.toMatch(/\b(console\.|fetch\(|indexedDB\b|Dexie\b|crypto\.randomUUID\(|Date\.now\()/);
    }
  });
});
