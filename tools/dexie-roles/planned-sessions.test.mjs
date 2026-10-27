import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ADHOC_SCHEMA, EXPECTED_ADHOC_ROLES, EXPECTED_CALENDAR_ROLES } from './adhoc-sessions.mjs';
import {
  CONFIRMATION, EXPECTED_PLANNED_ROLES, PLANNED_ROLE_OVERLAY, assertApprovedManifest,
  assertExactImportPayload, assertUnchangedBeforeApply, buildExpectedPlannedRoles,
  planPlannedSessions, validatePlannedDispatch, verifyPlannedSessions,
} from './planned-sessions.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const overlay = JSON.parse(read('../../cloud/planned-session-roles.json'));
const schema = { sealed: true, schema: { workoutOccurrences: '@id', ...ADHOC_SCHEMA.schema,
  existing: 'id' }, metadata: { retained: true } };
const roles = { roles: { ...structuredClone(EXPECTED_ADHOC_ROLES),
  unrelated: { permissions: { add: ['existing'] } } }, metadata: 'retained' };
const targetRoles = () => ({ ...structuredClone(roles), roles: {
  ...structuredClone(roles.roles), coach: structuredClone(EXPECTED_PLANNED_ROLES.coach),
} });
const plan = (s = schema, r = roles) => planPlannedSessions(overlay, s, r);
const trusted = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
  GITHUB_ACTOR: 'buropotok', GITHUB_REPOSITORY_OWNER: 'buropotok', DEXIE_PLANNED_OPERATION: 'preview' };

describe('approved protected planned session Coach ACL operator', () => {
  it('pins the overlay and derives only two appended fields from the exact ad-hoc baseline', () => {
    expect(overlay).toEqual(PLANNED_ROLE_OVERLAY);
    expect(() => assertApprovedManifest(overlay)).not.toThrow();
    const expected = structuredClone(EXPECTED_ADHOC_ROLES);
    expected.coach.permissions.update.workoutOccurrences.push('status', 'workoutSessionId');
    expect(buildExpectedPlannedRoles()).toEqual(expected);
    expect(EXPECTED_PLANNED_ROLES).toEqual(expected);
    expect(Object.isFrozen(EXPECTED_PLANNED_ROLES.coach.permissions.update.workoutOccurrences)).toBe(true);
    expect(() => buildExpectedPlannedRoles(EXPECTED_CALENDAR_ROLES)).toThrow('UNEXPECTED_ADHOC_BASELINE');
    const changed = structuredClone(EXPECTED_ADHOC_ROLES);
    changed.coach.permissions.add.push('other');
    expect(() => buildExpectedPlannedRoles(changed)).toThrow('UNEXPECTED_ADHOC_BASELINE');
  });

  it('proposes only a full Coach replacement, preserving all inputs and unrelated configuration', () => {
    const before = structuredClone({ schema, roles });
    expect(plan()).toEqual({ importPayload: { roles: { coach: EXPECTED_PLANNED_ROLES.coach } },
      changedRoles: ['coach'], changeCount: 1 });
    expect({ schema, roles }).toEqual(before);
    expect(plan(schema, targetRoles())).toEqual({ importPayload: {}, changedRoles: [], changeCount: 0 });
    for (const name of ['occurrenceId', 'occurrencePlan']) {
      expect(EXPECTED_PLANNED_ROLES.coach.permissions.update.adHocSessions).not.toContain(name);
    }
    expect(EXPECTED_PLANNED_ROLES.coach.permissions.update.adHocExercises).not.toContain('occurrenceExerciseId');
    expect(EXPECTED_PLANNED_ROLES.coach.permissions.update.adHocSets).not.toContain('occurrenceSetId');
  });

  it.each([
    r => { r.roles.coach.permissions.update.workoutOccurrences.push('status'); },
    r => { r.roles.coach.permissions.update.workoutOccurrences.push('workoutSessionId'); },
    r => { r.roles.coach.permissions.update.workoutOccurrences.reverse(); },
    r => { r.roles.coach.permissions.update.adHocSessions.push('occurrencePlan'); },
    r => { r.roles.coach.permissions.delete = ['adHocSets']; },
    r => { r.roles.coach.description = 'drift'; },
    r => { delete r.roles.coach; },
    r => { r.roles.client.permissions.update.workoutOccurrences.push('status'); },
  ])('fails closed on unknown, partial or broadened role baselines', mutate => {
    const changed = structuredClone(roles); mutate(changed);
    expect(() => plan(schema, changed)).toThrow();
  });

  it.each([
    o => { o.roles.coach.permissions.update.workoutOccurrences.push('owner'); },
    o => { o.roles.coach.permissions.update.adHocSessions = ['occurrenceId']; },
    o => { o.roles.client = {}; },
    o => { o.schema = {}; },
    o => { o.data = {}; },
  ])('rejects any manifest expansion', mutate => {
    const changed = structuredClone(overlay); mutate(changed);
    expect(() => planPlannedSessions(changed, schema, roles)).toThrow('INVALID_PLANNED_ROLE_OVERLAY');
  });

  it('requires preinstalled compatible tables and well-formed full exports', () => {
    for (const name of ['workoutOccurrences', ...Object.keys(ADHOC_SCHEMA.schema)]) {
      const missing = structuredClone(schema); delete missing.schema[name];
      const incompatible = structuredClone(schema); incompatible.schema[name] = 'id';
      expect(() => plan(missing)).toThrow('MISSING_OR_INCOMPATIBLE_SESSION_TABLE');
      expect(() => plan(incompatible)).toThrow('MISSING_OR_INCOMPATIBLE_SESSION_TABLE');
    }
    for (const invalid of [null, {}, { schema: [] }]) expect(() => plan(invalid)).toThrow();
    for (const invalid of [null, {}, { roles: [] }]) expect(() => plan(schema, invalid)).toThrow();
  });

  it('compares the entire schema and roles on immediate recheck and rejects payload tampering', () => {
    expect(() => assertUnchangedBeforeApply(schema, roles, structuredClone(schema), structuredClone(roles))).not.toThrow();
    const changedSchema = structuredClone(schema); changedSchema.metadata.retained = false;
    expect(() => assertUnchangedBeforeApply(schema, roles, changedSchema, roles)).toThrow();
    expect(() => assertUnchangedBeforeApply(schema, roles, schema, targetRoles())).toThrow();
    const payload = plan().importPayload;
    expect(() => assertExactImportPayload(payload, structuredClone(payload))).not.toThrow();
    expect(() => assertExactImportPayload(payload, { ...payload, schema: {} })).toThrow();
    expect(() => assertExactImportPayload(payload, { ...payload, data: {} })).toThrow();
  });

  it('requires exact target readback after any import attempt, even failed or no-op', () => {
    const verify = (s, r) => verifyPlannedSessions(overlay, schema, roles, s, r);
    expect(() => verify(structuredClone(schema), targetRoles())).not.toThrow();
    // An import error may have committed the whole delta, none, or only part.
    expect(() => verify(schema, roles)).toThrow('UNEXPECTED_ROLES_READBACK');
    const partial = structuredClone(roles);
    partial.roles.coach.permissions.update.workoutOccurrences.push('status');
    expect(() => verify(schema, partial)).toThrow('UNEXPECTED_ROLES_READBACK');
    const installed = targetRoles();
    expect(() => verifyPlannedSessions(overlay, schema, installed, schema, targetRoles())).not.toThrow();
    const drifted = targetRoles(); delete drifted.roles.unrelated;
    expect(() => verifyPlannedSessions(overlay, schema, installed, schema, drifted)).toThrow();
    for (const mutate of [s => { s.sealed = false; }, s => { s.schema.extra = '@id'; },
      s => { delete s.schema.existing; }, s => { s.metadata.retained = false; }]) {
      const changed = structuredClone(schema); mutate(changed);
      expect(() => verify(changed, targetRoles())).toThrow('UNEXPECTED_SCHEMA_READBACK');
    }
    for (const mutate of [r => { delete r.roles.unrelated; }, r => { r.roles.extra = {}; },
      r => { r.roles.client.permissions.add.push('adHocSets'); },
      r => { r.roles.coach.permissions.update.sessionSetFacts.push('owner'); },
      r => { r.metadata = 'changed'; }]) {
      const changed = targetRoles(); mutate(changed);
      expect(() => verify(schema, changed)).toThrow('UNEXPECTED_ROLES_READBACK');
    }
  });

  it('requires protected manual dispatch, exact apply confirmation and blank preview confirmation', () => {
    expect(CONFIRMATION).toBe('APPLY_PLANNED_SESSION_COACH_ACL');
    expect(() => validatePlannedDispatch(trusted)).not.toThrow();
    const apply = { ...trusted, DEXIE_PLANNED_OPERATION: 'apply', DEXIE_PLANNED_CONFIRMATION: CONFIRMATION };
    expect(() => validatePlannedDispatch(apply)).not.toThrow();
    for (const change of [{ GITHUB_EVENT_NAME: 'push' }, { GITHUB_EVENT_NAME: 'issues' },
      { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REF: 'refs/heads/feature' },
      { GITHUB_ACTOR: 'outsider' }, { GITHUB_ACTOR: '' }, { DEXIE_PLANNED_OPERATION: 'other' },
      { DEXIE_PLANNED_CONFIRMATION: CONFIRMATION }]) {
      expect(() => validatePlannedDispatch({ ...trusted, ...change })).toThrow();
    }
    for (const change of [{ GITHUB_EVENT_NAME: 'push' }, { GITHUB_EVENT_NAME: 'issues' },
      { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REF: 'refs/heads/feature' }, { GITHUB_ACTOR: 'outsider' }]) {
      expect(() => validatePlannedDispatch({ ...apply, ...change })).toThrow('UNAUTHORIZED_PLANNED_DISPATCH');
    }
    for (const confirmation of [undefined, '', ' ', CONFIRMATION + ' ', 'APPLY_ADHOC_SESSION_SCHEMA_AND_COACH_ACL']) {
      expect(() => validatePlannedDispatch({ ...apply, DEXIE_PLANNED_CONFIRMATION: confirmation }))
        .toThrow('INVALID_PLANNED_CONFIRMATION');
    }
  });

  it('protects manual preview/apply, immediate recheck, failure and no-op readback with existing credentials', () => {
    const workflow = read('../../.github/workflows/dexie-planned-sessions.yml');
    expect(workflow).toContain('options: [preview, apply]');
    expect(workflow).toContain('DEXIE_PLANNED_CONFIRMATION: ${{ inputs.confirmation }}');
    expect(workflow).toContain('name: dexie-production');
    expect(workflow).toContain('secrets.DEXIE_CLOUD_WRITE_KEY');
    expect(workflow).toContain('node tools/dexie-schema/manage.mjs prepare');
    expect(workflow).toContain('group: dexie-public-catalogue-publishing');
    expect(workflow).toContain("github.actor == github.repository_owner");
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).not.toMatch(/^\s+(push|pull_request|issues|issue_comment|schedule):/m);
    expect(workflow).not.toContain('type: boolean');
    expect(workflow).not.toContain('upload-artifact');
    for (const prefix of ['before', 'current', 'after']) {
      expect(workflow).toContain(`export --schema ${prefix}-schema.json`);
      expect(workflow).toContain(`export --roles ${prefix}-roles.json`);
    }
    expect(workflow).toContain('planned-sessions.mjs recheck');
    expect(workflow).toContain('planned-sessions.mjs verify');
    expect(workflow).toContain('id: plan');
    expect(workflow).toContain('id: import_attempt');
    expect(workflow).toContain('dexie-cloud import planned-proposal.json');
    expect(workflow.indexOf('planned-sessions.mjs recheck')).toBeLessThan(workflow.indexOf('id: import_attempt'));
    expect(workflow.indexOf('id: import_attempt')).toBeLessThan(workflow.indexOf('dexie-cloud import'));
    expect(workflow).toContain("if: inputs.operation == 'apply' && steps.plan.outputs.change_count != '0'");
    const readbackCondition = "if: ${{ !cancelled() && (inputs.operation == 'preview' || (inputs.operation == 'apply' && (steps.import_attempt.outputs.attempted == 'true' || steps.plan.outputs.change_count == '0'))) }}";
    expect(workflow.split(readbackCondition)).toHaveLength(3);
    expect(workflow).not.toContain('continue-on-error');
    expect(workflow).toContain('if: always()');
    expect(workflow).toContain('dexie-cloud@3.0.7');
  });

  it.each(['preview', 'apply'])('CLI %s plans, rechecks and verifies full snapshots without cloud calls', operation => {
    const temp = mkdtempSync(join(tmpdir(), 'planned-acl-'));
    const dir = join(temp, 'dexie-schema-123-1');
    mkdirSync(dir);
    const put = (name, value) => writeFileSync(join(dir, name), JSON.stringify(value));
    const env = { ...process.env, ...trusted, DEXIE_PLANNED_OPERATION: operation,
      DEXIE_PLANNED_CONFIRMATION: operation === 'apply' ? CONFIRMATION : '',
      RUNNER_TEMP: temp, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_OUTPUT: join(temp, 'output') };
    const run = (mode, change = {}) => spawnSync(process.execPath, ['tools/dexie-roles/planned-sessions.mjs', mode], {
      cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8', env: { ...env, ...change },
    });
    try {
      put('before-schema.json', schema); put('before-roles.json', roles);
      expect(run('preflight').status).toBe(0);
      const missingOutput = run('plan', { GITHUB_OUTPUT: '' });
      expect(missingOutput.stderr.trim()).toBe('GITHUB_OUTPUT_REQUIRED');
      expect(existsSync(join(dir, 'planned-proposal.json'))).toBe(false);
      expect(run('plan').status).toBe(0);
      expect(readFileSync(env.GITHUB_OUTPUT, 'utf8')).toBe('change_count=1\n');
      expect(JSON.parse(readFileSync(join(dir, 'planned-proposal.json'), 'utf8'))).toEqual(plan().importPayload);
      put('current-schema.json', schema); put('current-roles.json', roles);
      expect(run('recheck').status).toBe(0);
      put('current-roles.json', targetRoles());
      expect(run('recheck').stderr.trim()).toBe('CLOUD_CONFIGURATION_CHANGED_SINCE_PREVIEW');
      put('current-roles.json', roles);
      put('planned-proposal.json', { ...plan().importPayload, data: {} });
      expect(run('recheck').stderr.trim()).toBe('PLANNED_IMPORT_PAYLOAD_CHANGED');
      put('planned-proposal.json', plan().importPayload);
      put('after-schema.json', schema); put('after-roles.json', roles);
      expect(run('verify').status).toBe(operation === 'preview' ? 0 : 1);
      put('after-roles.json', targetRoles());
      expect(run('verify').status).toBe(operation === 'apply' ? 0 : 1);
      // Exact already-installed target: no import, but live final readback remains mandatory.
      put('before-roles.json', targetRoles()); put('current-roles.json', targetRoles());
      rmSync(join(dir, 'planned-proposal.json')); rmSync(env.GITHUB_OUTPUT);
      expect(run('plan').status).toBe(0);
      expect(readFileSync(env.GITHUB_OUTPUT, 'utf8')).toBe('change_count=0\n');
      expect(JSON.parse(readFileSync(join(dir, 'planned-proposal.json'), 'utf8'))).toEqual({});
      expect(run('recheck').status).toBe(0);
      expect(run('verify').status).toBe(0);
      const drifted = targetRoles(); drifted.metadata = 'changed'; put('after-roles.json', drifted);
      expect(run('verify').status).toBe(1);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });
});
