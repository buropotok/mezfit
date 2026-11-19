import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { processFile, isResult, createProcessor, adapterDescriptors } from '../index';
import { trainingAdapter, TRAINING_FORMAT } from '../adapters/training';
import { fixtureAdapter } from '../adapters/fixture';
import { nestedAdapter, NESTED_FORMAT } from '../adapters/nested';
import { createAdapterRegistry } from '../registry';
import { trainingFixture } from './fixture';
import { expectedTrainingPackage, matchesTrainingFixture } from './smoke-expectation';
import { isSourceImportPackage, requiredSourceIssues, sourcePackageStatus } from './validate';
import { PROCESSOR_INPUT_LIMIT, PROCESSOR_RESULT_LIMIT, SOURCE_PACKAGE_RESULT_LIMIT,
  PROCESSOR_VERSION, processorInstanceId, processorResultKey } from '../../../processor-protocol.mjs';

const encode = value => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).buffer;
const clone = value => JSON.parse(JSON.stringify(value));
const pkg = () => expectedTrainingPackage('a'.repeat(64));
const reissue = value => { value.issues = requiredSourceIssues(value); return value; };
const planSet = value => value.scheduledWorkouts[0].plan.exercises[0].sets[0];
const factSet = value => value.sessions[0].performedExercises[0].sets[0];
const process = value => processFile(encode(value), vi.fn());

describe('SourceImportPackage v1 runtime boundary', () => {
  it('accepts the complete canonical package, with issues distinct from publication permission', () => {
    expect(isSourceImportPackage(pkg())).toBe(true);
    expect(sourcePackageStatus(pkg())).toBe('valid-with-issues');
    const empty = pkg();
    for (const field of ['subjects', 'sourceExercises', 'programs', 'scheduledWorkouts', 'sessions', 'issues', 'omittedData']) empty[field] = [];
    expect(sourcePackageStatus(empty)).toBe('valid');
    expect(empty).not.toHaveProperty('publishable');
  });

  it.each([
    ['coverage contradiction', value => { value.coverage.programs = 'not_in_export'; }],
    ['root extra', value => { value.unknown = 1; }],
    ['version', value => { value.schemaVersion = 3; }],
    ['completion state', value => { value.sessions[0].completionState = 'published'; }],
    ['PROGRAM planned', value => { value.programs[0].days[0].exercises[0].sets[0].plannedWeight = 80; }],
    ['PROGRAM actual', value => { value.programs[0].days[0].exercises[0].sets[0].actualReps = 8; }],
    ['scalar attribute blob', value => { value.subjects[0].sourceAttributes.push({ name: 'raw', kind: 'string', value: {} }); }],
    ['missing field', value => { delete value.sessions[0].frozenPlan; }],
    ['oversized name', value => { value.subjects[0].displayName = 'x'.repeat(1001); }],
    ['oversized list', value => { value.subjects = Array.from({ length: 33 }, (_, n) => ({ ...value.subjects[0], sourceKey: 's' + n })); }],
    ['duplicate key', value => { value.programs.push(clone(value.programs[0])); }],
    ['duplicate position', value => { value.programs[0].days[0].exercises.push({ ...clone(value.programs[0].days[0].exercises[0]), sourceKey: 'another' }); }],
    ['fractional reps', value => { factSet(value).metrics.reps = 1.5; }],
    ['negative metric', value => { factSet(value).metrics.weight.value = -1; }],
    ['nonfinite metric', value => { factSet(value).metrics.weight.value = Infinity; }],
    ['wrong scalar', value => { factSet(value).metrics.reps = '8'; }],
    ['invalid leap date', value => { value.sessions[0].timing.localDate = '2026-02-29'; }],
    ['invalid timezone', value => { value.sessions[0].timing.timeZone = 'Mars/Foo'; }],
    ['date with fabricated time', value => { value.sessions[0].timing.startedAtUtc = '2026-10-14T00:00:00Z'; }],
    ['invalid timestamp', value => { Object.assign(value.sessions[0].timing, { precision: 'instant', startedAtUtc: '2026-02-30T00:00:00Z' }); }],
    ['reversed UTC', value => { Object.assign(value.sessions[0].timing, { precision: 'instant', startedAtUtc: '2026-10-14T00:00:00.1Z', completedAtUtc: '2026-10-14T00:00:00Z' }); }],
    ['unreviewed issue', value => { value.issues[0].code = 'RAW_PROVIDER_FAILURE'; }],
    ['missing prescription issue', value => { value.issues.shift(); }],
    ['missing unit issue', value => { value.issues = value.issues.filter(issue => issue.code !== 'UNKNOWN_UNIT'); }],
    ['reference discriminator extra', value => { value.sessions[1].programRef.sourceKey = 'program:p1'; }],
    ['wrong target type', value => { value.sessions[0].programRef.sourceKey = 'day:day'; }],
    ['foreign subject', value => { value.sessions[0].subjectRef.sourceKey = 'subject:q'; }],
    ['foreign phase', value => { value.programs[1].days[0].phaseRef = { state: 'linked', sourceKey: 'phase:phase' }; }],
    ['foreign program day', value => { value.scheduledWorkouts[0].programDayRef.sourceKey = 'day:day2'; }],
    ['wrong program exercise', value => { value.sessions[0].frozenPlan.exercises[0].sourceProgramExerciseRef.sourceKey = 'programExercise:pe2'; }],
    ['foreign program set', value => { value.sessions[0].frozenPlan.exercises[0].sets[0].sourceProgramSetRef.sourceKey = 'programSet:ps2'; }],
    ['occurrence set used as frozen plan', value => { factSet(value).planSetRef.sourceKey = 'planSet:os'; }],
    ['foreign frozen plan', value => { value.sessions[1].performedExercises[0].sets[0].planSetRef = { state: 'linked', sourceKey: 'planSet:ss' }; }],
  ])('rejects %s without coercion or silent repair', (_name, mutate) => {
    const value = pkg();
    mutate(value);
    expect(isSourceImportPackage(value)).toBe(false);
    expect(sourcePackageStatus(value)).toBe('invalid');
  });

  it('bounds deeply nested hostile values before schema traversal, including cycles', () => {
    const value = pkg();
    let cursor = value;
    for (let n = 0; n < 1000; n++) { cursor.deep = {}; cursor = cursor.deep; }
    expect(isSourceImportPackage(value)).toBe(false);
    const cyclic = pkg(); cyclic.loop = cyclic;
    expect(isSourceImportPackage(cyclic)).toBe(false);
  });

  it('validates a UTC instant with fractional seconds, preserves zero separately from null', () => {
    const value = pkg();
    Object.assign(value.sessions[0].timing, { precision: 'instant', startedAtUtc: '2026-10-14T00:00:00Z',
      completedAtUtc: '2026-10-14T00:00:00.1Z', timeZone: 'Europe/Moscow' });
    Object.assign(factSet(value).metrics, { reps: 0, weight: { value: 0, unit: 'kg' } });
    expect(isSourceImportPackage(value)).toBe(true);
    expect(factSet(value).metrics.reps).toBe(0);
    expect(value.sessions[1].performedExercises[0].sets[0].metrics.reps).toBeNull();
  });

  it('preserves dangling linked refs with explicit issues and independent valid FACT', () => {
    const value = pkg();
    value.sessions[0].scheduledWorkoutRef.sourceKey = 'scheduledWorkout:not-exported';
    expect(isSourceImportPackage(value)).toBe(false);
    reissue(value);
    expect(isSourceImportPackage(value)).toBe(true);
    expect(sourcePackageStatus(value)).toBe('valid-with-issues');
    expect(value.issues).toContainEqual({ code: 'UNRESOLVED_SOURCE_REFERENCE', severity: 'error', entityType: 'session',
      sourceKey: 'session:s', field: 'scheduledWorkoutRef' });
    expect(value.sessions[0].scheduledWorkoutRef.state).toBe('linked');
    expect(value.sessions[1].performedExercises[0].sets[0].metrics.duration.value).toBe(30);
  });

  it('retains none vs unknown regardless of empty/not-exported programs', () => {
    const value = pkg();
    value.programs = []; value.scheduledWorkouts = []; value.sessions = [value.sessions[1]];
    value.coverage.programs = 'not_in_export';
    value.sessions[0].programRef = { state: 'unknown' };
    reissue(value);
    expect(isSourceImportPackage(value)).toBe(true);
    expect(value.sessions[0].programRef).toEqual({ state: 'unknown' });
    expect(value.sessions[0].scheduledWorkoutRef).toEqual({ state: 'none' });
  });

  it('rejects a frozen PLAN linked to another day of the same program and exercise', () => {
    const value = pkg();
    const other = clone(value.programs[0].days[0]);
    other.sourceKey = 'day:other'; other.position = 1;
    other.exercises[0].sourceKey = 'programExercise:other';
    other.exercises[0].sets[0].sourceKey = 'programSet:other';
    value.programs[0].days.push(other);
    reissue(value);
    value.sessions[0].frozenPlan.exercises[0].sourceProgramExerciseRef.sourceKey = 'programExercise:other';
    value.sessions[0].frozenPlan.exercises[0].sets[0].sourceProgramSetRef.sourceKey = 'programSet:other';
    expect(isSourceImportPackage(value)).toBe(false);
  });

  it('preserves an incompatible source unit only with an issue, without converting values', () => {
    const value = pkg();
    factSet(value).metrics.weight = { value: 20, unit: 'seconds' };
    expect(isSourceImportPackage(value)).toBe(false);
    reissue(value);
    expect(isSourceImportPackage(value)).toBe(true);
    expect(factSet(value).metrics.weight).toEqual({ value: 20, unit: 'seconds' });
  });
});

describe('reviewed synthetic-training adapter through the common engine', () => {
  it('extracts the exact independent canonical graph, deterministically and beyond the old 1KiB bound', async () => {
    const input = trainingFixture();
    const bytes = encode(input);
    const result = await processFile(bytes, vi.fn());
    expect(result.schemaVersion).toBe(3);
    expect(result.sourcePackage).toEqual(expectedTrainingPackage(createHash('sha256').update(new Uint8Array(bytes)).digest('hex')));
    expect(matchesTrainingFixture(result)).toBe(true);
    expect(await processFile(bytes, vi.fn())).toEqual(result);
    expect(encode(result).byteLength).toBeGreaterThan(PROCESSOR_RESULT_LIMIT);
    expect(encode(result).byteLength).toBeLessThanOrEqual(SOURCE_PACKAGE_RESULT_LIMIT);
    expect(isResult(result)).toBe(true);
    const reordered = Object.fromEntries(Object.entries(input).reverse());
    const second = await process(reordered);
    second.sourcePackage.provenance.inputSha256 = result.inputSha256;
    expect(second.sourcePackage).toEqual(result.sourcePackage);
    expect(result.sourcePackage.programs[0].days[0].exercises[0].sets[0]).not.toHaveProperty('metrics');
    expect(result.sourcePackage.scheduledWorkouts[0].plan.exercises[0].sets[0].metrics.reps).toBe(10);
    expect(result.sourcePackage.sessions[0].frozenPlan.exercises[0].sets[0].metrics.reps).toBe(10);
    expect(result.sourcePackage.sessions[0].performedExercises[0].sets[0].metrics.reps).toBe(8);
  });

  it.each(['adapterId', 'adapterVersion', 'formatFamily', 'inputSha256', 'sourceApp', 'formatVersion', 'exportKind'])('refuses forged provenance %s', async field => {
    const result = await process(trainingFixture());
    result.sourcePackage.provenance[field] = field === 'inputSha256' ? '0'.repeat(64) : 'forged';
    expect(isResult(result)).toBe(false);
  });

  it.each([
    ['echo', () => pkg()],
    ['extra source data', () => ({ ...trainingFixture(), extra: 'private' })],
    ['duplicate source ID', () => { const value = trainingFixture(); value.people.push(value.people[0]); return value; }],
    ['oversized source', () => ' '.repeat(PROCESSOR_INPUT_LIMIT + 1)],
  ])('refuses %s', async (_name, source) => {
    if (_name === 'echo') expect((await process(source())).status).toBe('unsupported');
    else await expect(process(source())).rejects.toThrow();
  });

  it('rejects oversized canonical output and output metadata without exposing input names', async () => {
    const result = await process(trainingFixture());
    result.sourcePackage.subjects[0].displayName = 'x'.repeat(SOURCE_PACKAGE_RESULT_LIMIT);
    expect(isResult(result)).toBe(false);
    const emit = vi.fn();
    const source = trainingFixture(); source.history[0][1] = 'q';
    await expect(processFile(encode(source), emit)).rejects.toThrow();
    const trace = JSON.stringify(emit.mock.calls);
    for (const privateText of ['Synthetic Person', 'Source press', 'subject:q', 'program:p1', 'source_planned_weight']) expect(trace).not.toContain(privateText);
  });

  it('enforces the v3 byte ceiling independently of valid shape and graph limits', async () => {
    const result = await process(trainingFixture());
    const value = result.sourcePackage;
    while (value.subjects.length < 32) value.subjects.push({ ...clone(value.subjects[0]), sourceKey: 'subject:extra' + value.subjects.length });
    while (value.sourceExercises.length < 32) value.sourceExercises.push({ ...clone(value.sourceExercises[0]), sourceKey: 'exercise:extra' + value.sourceExercises.length });
    for (const subject of value.subjects) subject.displayName = 'x'.repeat(1000);
    for (const exercise of value.sourceExercises) exercise.sourceName = 'x'.repeat(1000);
    expect(isSourceImportPackage(value)).toBe(true);
    expect(encode(result).byteLength).toBeGreaterThan(SOURCE_PACKAGE_RESULT_LIMIT);
    expect(isResult(result)).toBe(false);
  });

  it('keeps reviewed registration pinned and preserves technical v1 identities', () => {
    expect(adapterDescriptors.map(row => row.adapterId)).toContain('synthetic-training');
    expect(trainingAdapter.descriptor).toMatchObject({ resultSchemaVersion: 3, adapterVersion: '1.0.0', maxInputBytes: 8192 });
    expect(() => createAdapterRegistry([{ ...trainingAdapter, descriptor: { ...trainingAdapter.descriptor, resultSchemaVersion: 4 } }])).toThrow('INVALID_ADAPTER_REGISTRY');
    expect(PROCESSOR_VERSION).toBe('v1');
    expect(processorInstanceId('id')).toBe('process-v1-id');
    expect(processorResultKey('id')).toBe('results/id/v1/result.json');
  });

  it.each([
    { format: 'mezfit-synthetic-json-v1', records: [{ value: 7 }] },
    { format: NESTED_FORMAT, container: { groups: [{ sourceId: 'g', items: [{ sourceId: 'a', amount: 7, peerId: null }] }] } },
  ])('retains the exact bytes and digest of legacy result $format with the third adapter registered', async input => {
    // Use the released processors as the compatibility oracle, including JSON order.
    if (input.records) input.format = fixtureAdapter.descriptor.format;
    const legacy = createProcessor([fixtureAdapter, nestedAdapter]);
    const before = await legacy.processFile(encode(input), vi.fn());
    const after = await process(input);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(createHash('sha256').update(JSON.stringify(after)).digest('hex')).toBe(createHash('sha256').update(JSON.stringify(before)).digest('hex'));
    expect(encode(after).byteLength).toBeLessThanOrEqual(PROCESSOR_RESULT_LIMIT);
  });
});
