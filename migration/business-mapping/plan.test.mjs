import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { businessInput } from './fixtures';
import { buildMezfitImportPlan } from './plan';
import { isBuildMezfitImportPlanInput, isMezfitImportPlan } from './validate';
import { isSourceImportPackage, requiredSourceIssues } from '../worker/processor/source-package/validate';
import { convertMetrics } from './measure';

const clone = value => structuredClone(value);
const reissue = input => { input.sourcePackage.issues = requiredSourceIssues(input.sourcePackage); return input; };
const find = (plan, kind, sourceKey) => plan.operations.find(o =>
  o.kind === kind && o.sourceRefs.some(r => r.sourceKey === sourceKey));
const session = (plan, key) => find(plan, 'historical_session', key);
const schedule = (plan, key) => find(plan, 'standalone_scheduled', key);
const issues = (plan, code) => plan.issues.filter(x => x.code === code);

describe('MIG-05 business mapping: contract and read-only planning', () => {
  it('accepts independent input and produces a strictly validated, versioned plan', async () => {
    const input = businessInput();
    expect(isSourceImportPackage(input.sourcePackage)).toBe(true);
    expect(isBuildMezfitImportPlanInput(input)).toBe(true);
    const plan = await buildMezfitImportPlan(input);
    expect(isMezfitImportPlan(plan)).toBe(true);
    expect(plan.kind).toBe('mezfit.import-plan');
    expect(plan.schemaVersion).toBe(1);
    expect(plan.planId).toMatch(/^[a-f0-9]{64}$/);
    expect(plan.scope.programs).toBe('linked-only');
    expect(plan.readiness).toBe('requires_decisions');
    expect(plan).not.toHaveProperty('publishable');
    expect(plan).not.toHaveProperty('realmId');
    expect(plan.targetBindings[0].kind).toBe('provisional_imported_client');
    expect(JSON.stringify(plan)).not.toContain('rlm-temp');
  });

  it('selects sessions only within period and globally suppresses a scheduled linked to a session', async () => {
    const plan = await buildMezfitImportPlan(businessInput());
    expect(plan.preview.source).toEqual({ sessions: 2, scheduledWorkouts: 2, programs: 1, exercises: 2 });
    expect(plan.preview.selected.sessions).toBe(2);
    expect(plan.preview.linkedScheduledSuppressed).toBe(1);
    expect(schedule(plan, 'sw:linked')).toBeUndefined();
    expect(schedule(plan, 'sw:solo')).toBeDefined();
    expect(schedule(plan, 'sw:solo').timing.missed).toBe('undetermined');
    expect(schedule(plan, 'sw:solo').state).toBe('blocked');
    expect(issues(plan, 'SCHEDULE_END_UNKNOWN').length).toBeGreaterThan(0);
  });

  it('selects full source program regardless of creation year, preserving phases, sets and order', async () => {
    const plan = await buildMezfitImportPlan(businessInput());
    const program = find(plan, 'program', 'p:old');
    expect(program).toBeDefined();
    expect(program.program.phases).toHaveLength(1);
    expect(program.program.days[0].exercises.map(x => x.sourceKey)).toEqual(['pe:bench', 'pe:hold']);
    expect(program.program.days[0].exercises[0].sets.map(x => x.sourceKey)).toEqual(['ps:1', 'ps:2']);
    expect(program.program.days[0].exercises[0].sets[1].comment).toBe('Slow eccentric');
    expect(program.program.days[0].exercises[0].sets[0]).not.toHaveProperty('plannedReps');
    expect(program.program.days[0].exercises[0].sets[0]).not.toHaveProperty('actualWeightKg');
    expect(program.program.days[0].exercises[0].sets[0]).not.toHaveProperty('metrics');
  });

  it('preserves frozen session PLAN separately from factual results, including completed provenance', async () => {
    const plan = await buildMezfitImportPlan(businessInput());
    const done = session(plan, 'ses:linked');
    expect(done.completionState).toBe('completed');
    expect(done.importedProvenance).toBe(true);
    expect(done.frozenPlan.state).toBe('present');
    expect(done.frozenPlan.exercises[0].sets[0].metrics.weight.value).toBe(50);
    expect(done.fact[0].sets[0].metrics.weight.value).toBe(55);
    expect(done.fact[0].sets[0].metrics.reps).toBe(8);
    const marker = find(plan, 'provenance_metadata', 'ses:linked');
    expect(marker.forOperationKey).toBe(done.operationKey);
    expect(marker.marker).toBe('imported');
  });

  it('keeps independent Ad-hoc as FACT-only without fake occurrence or frozen PLAN', async () => {
    const plan = await buildMezfitImportPlan(businessInput());
    const own = session(plan, 'ses:adhoc');
    expect(own.programRef).toEqual({ state: 'none' });
    expect(own.scheduledWorkoutRef).toEqual({ state: 'none' });
    expect(own.frozenPlan).toEqual({ state: 'absent' });
    expect(own.fact[0].sets[0].metrics.duration.value).toBe(60);
    expect(own.fact[0].sets[0].metrics.duration.originalUnit).toBe('min');
    expect(plan.operations.filter(o => o.kind === 'standalone_scheduled')).toHaveLength(1);
  });

  it('preserves standalone scheduled numeric PLAN, including explicit zero, even if scheduling is blocked', async () => {
    const plan = await buildMezfitImportPlan(businessInput());
    const standalone = schedule(plan, 'sw:solo');
    expect(standalone.plan.state).toBe('present');
    expect(standalone.plan.exercises[0].sets[0].metrics.reps).toBe(12);
    expect(standalone.plan.exercises[0].sets[0].metrics.weight.value).toBe(0);
    expect(standalone.plan.exercises[0].sets[0].sourceMetrics.weight.value).toBe(0);
    expect(standalone.programRef).toEqual({ state: 'linked', sourceKey: 'p:old' });
  });

  it('matches only evidenced exact unique catalogue definitions, creates shared imported custom proposal', async () => {
    const plan = await buildMezfitImportPlan(businessInput());
    expect(plan.preview.catalogMatched).toBe(1);
    expect(plan.preview.proposedCustomExercises).toBe(1);
    const match = plan.exerciseMappings.find(x => x.sourceExerciseKey === 'ex:bench');
    const custom = plan.exerciseMappings.find(x => x.sourceExerciseKey === 'ex:hold');
    expect(match).toMatchObject({ kind: 'catalog_match', catalogueExerciseId: '0001', matchEvidence: 'exact_unique' });
    expect(custom).toMatchObject({ kind: 'proposed_custom', requiresReconciliation: true });
    const proposed = plan.operations.find(o => o.kind === 'proposed_custom_exercise');
    expect(proposed.exerciseIdentityKey).toBe(custom.identityKey);
    expect(proposed.targetScope).toBe('coach');
    expect(session(plan, 'ses:adhoc').dependencyKeys).toContain(proposed.operationKey);
    expect(find(plan, 'program', 'p:old').dependencyKeys).toContain(proposed.operationKey);
  });

  it('two plausible catalogue candidates cause proposed custom, never an ambiguous catalog match', async () => {
    const input = businessInput();
    input.catalogueSnapshot.entries.push({
      id: '0002', scope: 'public', name: 'Bench Press', equipment: 'barbell', trackingType: 'weight_reps',
    });
    const plan = await buildMezfitImportPlan(input);
    expect(plan.exerciseMappings.find(x => x.sourceExerciseKey === 'ex:bench').kind).toBe('proposed_custom');
  });

  it('does not silently infer tracking type, name, or incompatible dimensions', async () => {
    const input = businessInput();
    input.sourcePackage.sourceExercises[1].trackingHint = null;
    const plan = await buildMezfitImportPlan(input);
    expect(plan.exerciseMappings.find(x => x.sourceExerciseKey === 'ex:hold')).toMatchObject({
      kind: 'blocked', reason: 'UNKNOWN_TRACKING',
    });
    expect(session(plan, 'ses:adhoc').state).toBe('blocked');
    // The linked program contains the same unresolved definition, so its dependent session also blocks.
    expect(session(plan, 'ses:linked').state).toBe('blocked');
    expect(convertMetrics({ reps: 4, weight: { value: 20, unit: 'kg' }, duration: null, distance: null }, 'time'))
      .toMatchObject({ metrics: null, issues: ['TRACKING_METRICS_CONFLICT'] });
  });

  it('converts supported units with fixed six-decimal precision, preserves zero and null', () => {
    const base = { reps: 0, weight: { value: 100, unit: 'lb' }, duration: null, distance: null };
    expect(convertMetrics(base, 'weight_reps').metrics).toMatchObject({
      reps: 0, weight: { value: 45.359237, unit: 'kg', originalValue: 100, originalUnit: 'lb', precision: 6 },
      duration: null, distance: null,
    });
    expect(convertMetrics({ reps: null, weight: { value: 1000, unit: 'g' }, duration: null, distance: null }, 'weight_reps')
      .metrics.weight.value).toBe(1);
    expect(convertMetrics({ reps: null, weight: null, duration: { value: 1500, unit: 'ms' },
      distance: { value: 1, unit: 'mi' } }, 'time_distance').metrics)
      .toMatchObject({ duration: { value: 1.5, unit: 's' }, distance: { value: 1609.344, unit: 'm' } });
    expect(convertMetrics({ reps: null, weight: null, duration: { value: 1, unit: 'h' },
      distance: null }, 'time').metrics.duration.value).toBe(3600);
    expect(convertMetrics({ reps: null, weight: null, duration: { value: 1, unit: 'sec' },
      distance: { value: 100, unit: 'cm' } }, 'time_distance').metrics.distance.value).toBe(1);
    expect(convertMetrics({ reps: null, weight: null, duration: null, distance: { value: 3, unit: 'ft' } },
      'time_distance').metrics.distance.value).toBe(0.9144);
  });

  it('unsupported unit remains in source metrics and blocks an entire workout', async () => {
    const input = businessInput();
    input.sourcePackage.sessions[0].performedExercises[0].sets[0].metrics.weight.unit = 'stone';
    reissue(input);
    expect(isSourceImportPackage(input.sourcePackage)).toBe(true);
    const plan = await buildMezfitImportPlan(input);
    const done = session(plan, 'ses:linked');
    expect(done.state).toBe('blocked');
    expect(done.fact[0].sets[0].sourceMetrics.weight.unit).toBe('stone');
    expect(issues(plan, 'UNSUPPORTED_UNIT')).toHaveLength(1);
    expect(session(plan, 'ses:adhoc').state).toBe('selected');
  });

  it('source numeric prescriptions stay in program attributes, not fake occurrence or program PLAN', async () => {
    const input = businessInput();
    input.sourcePackage.programs[0].days[0].exercises[0].sets[0].sourceAttributes.push({
      name: 'source_planned_weight', kind: 'number', value: 80, unit: 'kg',
    });
    reissue(input);
    const plan = await buildMezfitImportPlan(input);
    const program = find(plan, 'program', 'p:old');
    expect(program.program.days[0].exercises[0].sets[0].sourceAttributes).toMatchObject([
      { name: 'source_planned_weight', value: 80, unit: 'kg' },
    ]);
    expect(program.program.days[0].exercises[0].sets[0]).not.toHaveProperty('plannedWeightKg');
    expect(issues(plan, 'SOURCE_PROGRAM_NUMERIC_PRESCRIPTION').length).toBeGreaterThan(0);
  });

  it('globally finds linked sessions OUTSIDE the window before scheduled deduplication', async () => {
    const input = businessInput();
    input.sourcePackage.sessions[0].timing = {
      localDate: '2025-10-10', startedAtUtc: '2025-10-10T09:00:00.000Z',
      completedAtUtc: '2025-10-10T10:00:00.000Z', timeZone: 'UTC', precision: 'instant',
    };
    const plan = await buildMezfitImportPlan(input);
    expect(plan.preview.outsidePeriod.sessions).toBe(1);
    expect(plan.preview.linkedScheduledSuppressed).toBe(1);
    expect(schedule(plan, 'sw:linked')).toBeUndefined();
    expect(session(plan, 'ses:linked')).toBeUndefined();
  });

  it('in-window linked session imports without an out-of-window scheduled operation', async () => {
    const input = businessInput();
    input.sourcePackage.scheduledWorkouts[0].timing.localDate = '2025-10-10';
    input.sourcePackage.scheduledWorkouts[0].timing.startedAtUtc = '2025-10-10T09:00:00.000Z';
    const plan = await buildMezfitImportPlan(input);
    expect(session(plan, 'ses:linked')).toBeDefined();
    expect(schedule(plan, 'sw:linked')).toBeUndefined();
    expect(plan.preview.outsidePeriod.scheduledWorkouts).toBe(1);
  });

  it('does not deduplicate by date or name without explicit source linked ref', async () => {
    const input = businessInput();
    input.sourcePackage.sessions[0].scheduledWorkoutRef = { state: 'none' };
    const plan = await buildMezfitImportPlan(input);
    expect(session(plan, 'ses:linked')).toBeDefined();
    expect(schedule(plan, 'sw:linked')).toBeDefined();
    expect(plan.preview.linkedScheduledSuppressed).toBe(0);
  });

  it('partial session export blocks uncertain standalone scheduled operations, not valid sessions', async () => {
    const input = businessInput();
    input.sourcePackage.coverage.sessions = 'partial';
    const plan = await buildMezfitImportPlan(input);
    expect(issues(plan, 'SCHEDULE_LINK_UNCERTAIN').length).toBeGreaterThan(0);
    expect(schedule(plan, 'sw:solo').state).toBe('blocked');
    expect(session(plan, 'ses:linked').state).toBe('selected');
  });

  it('several sessions can point to one schedule; each remains a separate historical operation', async () => {
    const input = businessInput();
    const extra = clone(input.sourcePackage.sessions[0]);
    extra.sourceKey = 'ses:second';
    extra.frozenPlan.exercises[0].sourceKey = 'fp:e-second';
    extra.frozenPlan.exercises[0].sets[0].sourceKey = 'fp:s-second';
    extra.performedExercises[0].sourceKey = 'fx:e-second';
    extra.performedExercises[0].sets[0].sourceKey = 'fx:s-second';
    extra.performedExercises[0].sets[0].planSetRef.sourceKey = 'fp:s-second';
    input.sourcePackage.sessions.push(extra);
    expect(isSourceImportPackage(input.sourcePackage)).toBe(true);
    const plan = await buildMezfitImportPlan(input);
    expect(session(plan, 'ses:linked')).toBeDefined();
    expect(session(plan, 'ses:second')).toBeDefined();
    expect(schedule(plan, 'sw:linked')).toBeUndefined();
  });

  it('period bounds are inclusive; outside counts are deliberate exclusions', async () => {
    const input = businessInput();
    input.period.fromDate = '2026-10-10';
    input.period.throughDate = '2026-10-11';
    const plan = await buildMezfitImportPlan(input);
    expect(plan.preview.outsidePeriod).toEqual({ sessions: 0, scheduledWorkouts: 1 });
    expect(session(plan, 'ses:linked')).toBeDefined();
    expect(session(plan, 'ses:adhoc')).toBeDefined();
    const again = await buildMezfitImportPlan(clone(input));
    expect(again.planId).toBe(plan.planId);
  });

  it('source local business date prevails over UTC rollover; an unknown date is blocked, not hidden', async () => {
    const input = businessInput();
    input.sourcePackage.sessions[1].timing = {
      localDate: null, startedAtUtc: null, completedAtUtc: null,
      timeZone: null, precision: 'unknown',
    };
    const plan = await buildMezfitImportPlan(input);
    expect(session(plan, 'ses:adhoc')).toBeDefined();
    expect(session(plan, 'ses:adhoc').state).toBe('blocked');
    expect(issues(plan, 'UNKNOWN_BUSINESS_DATE').length).toBeGreaterThan(0);
  });

  it('derives source business day only when UTC and a trustworthy source timezone are provided', async () => {
    const input = businessInput();
    input.sourcePackage.sessions[1].timing = {
      localDate: null, startedAtUtc: '2026-10-11T00:30:00.000Z',
      completedAtUtc: '2026-10-11T01:30:00.000Z',
      timeZone: 'America/Los_Angeles', precision: 'instant',
    };
    input.period.fromDate = '2026-10-10';
    input.period.throughDate = '2026-10-10';
    const plan = await buildMezfitImportPlan(input);
    expect(session(plan, 'ses:adhoc')).toBeDefined();
    expect(session(plan, 'ses:adhoc').state).toBe('selected');
  });

  it('date-only with reliable IANA zone proposes 08:00 onward, respecting occupied intervals and DST', async () => {
    const input = businessInput();
    input.sourcePackage.sessions[1].timing = {
      localDate: '2026-10-10', startedAtUtc: null, completedAtUtc: null,
      timeZone: 'Europe/Warsaw', precision: 'date',
    };
    input.calendarOccupancySnapshot.intervals = [{
      startsAtUtc: '2026-10-10T06:00:00.000Z', endsAtUtc: '2026-10-10T06:30:00.000Z',
    }];
    const plan = await buildMezfitImportPlan(input);
    expect(session(plan, 'ses:adhoc').timing.proposedStartsAtUtc).toBe('2026-10-10T06:30:00.000Z');
    expect(session(plan, 'ses:adhoc').timing.importTimeInferred).toBe(true);
    expect(session(plan, 'ses:adhoc').state).toBe('blocked');
    expect(issues(plan, 'TIME_INFERRED').length).toBeGreaterThan(0);
    expect(issues(plan, 'TIME_DURATION_UNKNOWN').length).toBeGreaterThan(0);
  });

  it('date-only with unknown timezone never invents a UTC start', async () => {
    const input = businessInput();
    input.sourcePackage.sessions[1].timing = {
      localDate: '2026-10-11', startedAtUtc: null, completedAtUtc: null,
      timeZone: null, precision: 'date',
    };
    const plan = await buildMezfitImportPlan(input);
    expect(session(plan, 'ses:adhoc').timing.proposedStartsAtUtc).toBeNull();
    expect(issues(plan, 'UNKNOWN_SOURCE_TIMEZONE').length).toBeGreaterThan(0);
  });

  it('in_progress and unknown sessions are retained as blocked candidates, not completed', async () => {
    for (const completionState of ['in_progress', 'unknown']) {
      const input = businessInput();
      input.sourcePackage.sessions[1].completionState = completionState;
      const plan = await buildMezfitImportPlan(input);
      expect(session(plan, 'ses:adhoc').completionState).toBe(completionState);
      expect(session(plan, 'ses:adhoc').state).toBe('blocked');
      expect(plan.preview.incompleteSessions).toBe(1);
      expect(session(plan, 'ses:linked').state).toBe('selected');
    }
  });

  it('programs with no selected workout are excluded, while the linked older program is included', async () => {
    const input = businessInput();
    input.sourcePackage.programs.push({
      sourceKey: 'p:unused', subjectRef: { state: 'linked', sourceKey: 'subject:p' },
      name: 'Unused 2026 plan', sourceAttributes: [], phases: [], days: [],
    });
    const plan = await buildMezfitImportPlan(input);
    expect(find(plan, 'program', 'p:old')).toBeDefined();
    expect(find(plan, 'program', 'p:unused')).toBeUndefined();
  });

  it('proves no program before creating one active synthetic phase/day, without linking historical Ad-hoc back', async () => {
    const input = businessInput();
    input.sourcePackage.programs = [];
    input.sourcePackage.scheduledWorkouts = [];
    input.sourcePackage.sessions = [input.sourcePackage.sessions[1]];
    reissue(input);
    const plan = await buildMezfitImportPlan(input);
    const program = plan.operations.find(o => o.kind === 'program');
    expect(program.program.syntheticFromSessionKey).toBe('ses:adhoc');
    expect(program.program.phases).toHaveLength(1);
    expect(program.program.days).toHaveLength(1);
    expect(program.program.days[0].exercises).toHaveLength(1);
    expect(program.program.days[0].exercises[0].sets).toHaveLength(1);
    expect(program.program.days[0].exercises[0].sets[0]).not.toHaveProperty('metrics');
    expect(session(plan, 'ses:adhoc').programRef).toEqual({ state: 'none' });
    expect(session(plan, 'ses:adhoc').dependencyKeys).not.toContain(program.operationKey);
  });

  it('does not create a default program from absent export / unknown links', async () => {
    const input = businessInput();
    input.sourcePackage.programs = [];
    input.sourcePackage.scheduledWorkouts = [];
    input.sourcePackage.sessions = [input.sourcePackage.sessions[1]];
    input.sourcePackage.sessions[0].programRef = { state: 'unknown' };
    input.sourcePackage.coverage.programs = 'not_in_export';
    reissue(input);
    const plan = await buildMezfitImportPlan(input);
    expect(plan.operations.some(o => o.kind === 'program')).toBe(false);
    expect(session(plan, 'ses:adhoc').state).toBe('blocked');
  });

  it('active-program conflict never overwrites a target program; unrelated valid history remains intact', async () => {
    const input = businessInput();
    input.targetContextSnapshot.activeProgramSubjectKeys = ['subject:p'];
    const plan = await buildMezfitImportPlan(input);
    expect(find(plan, 'program', 'p:old').state).toBe('blocked');
    expect(issues(plan, 'ACTIVE_PROGRAM_CONFLICT').length).toBeGreaterThan(0);
    expect(session(plan, 'ses:adhoc').state).toBe('selected');
    expect(session(plan, 'ses:linked').state).toBe('blocked');
  });

  it('coach exclusion cascades through dependency closure; no orphan session survives', async () => {
    const input = businessInput();
    input.selectionSnapshot.exclusions = [{ kind: 'program', sourceKey: 'p:old' }];
    const plan = await buildMezfitImportPlan(input);
    const program = find(plan, 'program', 'p:old');
    expect(program.state).toBe('excluded_by_coach');
    expect(session(plan, 'ses:linked').state).toBe('blocked');
    expect(session(plan, 'ses:adhoc').state).toBe('selected');
    expect(plan.selections.find(s => s.groupKey === session(plan, 'ses:linked').operationKey)
      .dependencyClosure).toContain(program.operationKey);
  });

  it('same source identity and snapshots are deterministic under reordered unordered arrays', async () => {
    const input = businessInput();
    const first = await buildMezfitImportPlan(input);
    const copy = clone(input);
    copy.sourcePackage.sourceExercises.reverse();
    copy.sourcePackage.scheduledWorkouts.reverse();
    copy.sourcePackage.sessions.reverse();
    copy.sourcePackage.programs[0].days[0].exercises.reverse();
    copy.catalogueSnapshot.entries.reverse();
    const second = await buildMezfitImportPlan(copy);
    expect(second.planId).toBe(first.planId);
    expect(second.operations).toEqual(first.operations);
  });

  it('changes to catalogue, target or occupancy invalidate plan identity', async () => {
    const first = await buildMezfitImportPlan(businessInput());
    for (const field of ['catalogue', 'target', 'occupancy']) {
      const input = businessInput();
      if (field === 'catalogue') input.catalogueSnapshot.entries[0].name += ' Variation';
      if (field === 'target') input.targetContextSnapshot.datasetKey += ':new';
      if (field === 'occupancy') input.calendarOccupancySnapshot.intervals.push({
        startsAtUtc: '2026-10-10T10:00:00.000Z', endsAtUtc: '2026-10-10T11:00:00.000Z',
      });
      expect((await buildMezfitImportPlan(input)).planId).not.toBe(first.planId);
    }
  });

  it('recognizes overlapping re-exports by stable source identity, not inputSha256', async () => {
    const original = await buildMezfitImportPlan(businessInput());
    const prior = session(original, 'ses:linked').operationKey;
    const input = businessInput();
    input.sourcePackage.provenance.inputSha256 = 'b'.repeat(64);
    input.existingImportsSnapshot.identities = [prior];
    const plan = await buildMezfitImportPlan(input);
    expect(session(plan, 'ses:linked').operationKey).toBe(prior);
    expect(session(plan, 'ses:linked').state).toBe('already_imported');
    // Both the historical session and its provenance action are recognized as replayed.
    expect(plan.preview.alreadyImported).toBe(2);
    expect(plan.planId).not.toBe(original.planId);
  });

  it('separates exercise identities across datasets even for identical source keys', async () => {
    const first = await buildMezfitImportPlan(businessInput());
    const input = businessInput();
    input.targetContextSnapshot.datasetKey = 'different-source-dataset';
    const second = await buildMezfitImportPlan(input);
    expect(second.exerciseMappings[0].identityKey).not.toBe(first.exerciseMappings[0].identityKey);
  });

  it('rejects malformed snapshots and source packages before mapping, without mutation', async () => {
    const input = businessInput();
    const before = clone(input);
    await buildMezfitImportPlan(input);
    expect(input).toEqual(before);
    const extra = businessInput(); extra.catalogueSnapshot.unknown = 'unexpected';
    expect(isBuildMezfitImportPlanInput(extra)).toBe(false);
    await expect(buildMezfitImportPlan(extra)).rejects.toThrow('IMPORT_PLAN_INVALID_INPUT');
    const cycle = businessInput(); cycle.targetContextSnapshot.loop = cycle.targetContextSnapshot;
    await expect(buildMezfitImportPlan(cycle)).rejects.toThrow('IMPORT_PLAN_INVALID_INPUT');
    const wrong = businessInput(); wrong.sourcePackage.sessions[0].subjectRef.sourceKey = 'other-client';
    await expect(buildMezfitImportPlan(wrong)).rejects.toThrow('IMPORT_PLAN_INVALID_INPUT');
    const invalid = businessInput(); invalid.selectionSnapshot.exclusions.push({
      kind: 'delete_user', sourceKey: 'ses:adhoc',
    });
    await expect(buildMezfitImportPlan(invalid)).rejects.toThrow('IMPORT_PLAN_INVALID_INPUT');
  });

  it('refuses broken output dependency graphs and undocumented operation variants', async () => {
    const plan = await buildMezfitImportPlan(businessInput());
    const broken = clone(plan);
    broken.operations[0].dependencyKeys.push('nonexistent');
    expect(isMezfitImportPlan(broken)).toBe(false);
    const fabricated = clone(plan);
    fabricated.operations[0].kind = 'generic_row_write';
    expect(isMezfitImportPlan(fabricated)).toBe(false);
  });

  it('imports no Dexie, Cloudflare Worker, networking, or privileged APIs', () => {
    const root = fileURLToPath(new URL('.', import.meta.url));
    for (const path of ['plan.ts', 'timing.ts', 'measure.ts', 'canonical.ts', 'validate.ts']) {
      const source = readFileSync(root + path, 'utf8');
      expect(source).not.toMatch(/from ['"][^'"]*(?:database|dexie|worker\/lib|api)['"]/i);
      expect(source).not.toMatch(/\b(?:fetch|bulkPut|\.put\(|\.add\(|\.delete\(|Date\.now|randomUUID)\s*\(/);
    }
  });
});
