import { readFileSync } from 'node:fs';
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

describe('DRAFT planned session role proposal; no activation', () => {
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

  it('requires exact target readback after any future import attempt, even failed or no-op', () => {
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

  it('allows only protected manual preview and refuses apply even with approval and confirmation', () => {
    expect(CONFIRMATION).toBe('APPLY_PLANNED_SESSION_COACH_ACL');
    expect(() => validatePlannedDispatch(trusted)).not.toThrow();
    for (const change of [{ GITHUB_EVENT_NAME: 'push' }, { GITHUB_EVENT_NAME: 'issues' },
      { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REF: 'refs/heads/feature' },
      { GITHUB_ACTOR: 'outsider' }, { GITHUB_ACTOR: '' }, { DEXIE_PLANNED_OPERATION: 'other' },
      { DEXIE_PLANNED_CONFIRMATION: CONFIRMATION }]) {
      expect(() => validatePlannedDispatch({ ...trusted, ...change })).toThrow();
    }
    for (const marker of [undefined, '', 'false', 'TRUE']) {
      expect(() => validatePlannedDispatch({ ...trusted, DEXIE_PLANNED_OPERATION: 'apply',
        PLANNED_SESSION_LOCAL_START_APPROVED: marker })).toThrow('LOCAL_START_NOT_APPROVED');
    }
    expect(() => validatePlannedDispatch({ ...trusted, DEXIE_PLANNED_OPERATION: 'apply',
      PLANNED_SESSION_LOCAL_START_APPROVED: 'true', DEXIE_PLANNED_CONFIRMATION: CONFIRMATION }))
      .toThrow('PLANNED_APPLY_NOT_IMPLEMENTED');
  });

  it('keeps the workflow preview-only with existing protected credentials and shared writer lock', () => {
    const workflow = read('../../.github/workflows/dexie-planned-sessions.yml');
    expect(workflow).toContain('options: [preview]');
    expect(workflow).toContain('name: dexie-production');
    expect(workflow).toContain('secrets.DEXIE_CLOUD_WRITE_KEY');
    expect(workflow).toContain('node tools/dexie-schema/manage.mjs prepare');
    expect(workflow).toContain('group: dexie-public-catalogue-publishing');
    expect(workflow).toContain("github.actor == github.repository_owner");
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).not.toMatch(/^\s+(push|pull_request|issues|issue_comment|schedule):/m);
    expect(workflow).not.toMatch(/dexie-cloud import|options:.*apply|type: boolean|PLANNED_SESSION_LOCAL_START_APPROVED:/);
    expect(workflow).not.toContain('upload-artifact');
    for (const prefix of ['before', 'current', 'after']) {
      expect(workflow).toContain(`export --schema ${prefix}-schema.json`);
      expect(workflow).toContain(`export --roles ${prefix}-roles.json`);
    }
    expect(workflow).toContain('planned-sessions.mjs recheck');
    expect(workflow).toContain('planned-sessions.mjs verify');
    expect(workflow).toContain('if: always()');
    expect(workflow).toContain('dexie-cloud@3.0.7');
  });
});
