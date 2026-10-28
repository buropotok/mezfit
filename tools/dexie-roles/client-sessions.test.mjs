import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ADHOC_SCHEMA } from './adhoc-sessions.mjs';
import { EXPECTED_CANCELLATION_ROLES } from './calendar-cancellation.mjs';
import { CONFIRMATION, EXPECTED_CLIENT_SESSION_ROLES, CLIENT_SESSION_ROLE_OVERLAY,
  planClientSessions, verifyClientSessions, validateClientSessionDispatch,
  assertUnchangedBeforeApply, assertExactImportPayload } from './client-sessions.mjs';

const overlay = JSON.parse(readFileSync(new URL('../../cloud/client-session-roles.json', import.meta.url), 'utf8'));
const schema = { schema: { workoutOccurrences: '@id', ...ADHOC_SCHEMA.schema, other: 'id' }, marker: 'retained' };
const roles = { roles: { ...structuredClone(EXPECTED_CANCELLATION_ROLES), unrelated: { permissions: { add: ['other'] } } }, marker: 'retained' };
const target = () => ({ ...structuredClone(roles), roles: { ...structuredClone(roles.roles), client: structuredClone(EXPECTED_CLIENT_SESSION_ROLES.client) } });
const trusted = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
  GITHUB_ACTOR: 'buropotok', GITHUB_REPOSITORY_OWNER: 'buropotok', DEXIE_CLIENT_SESSION_OPERATION: 'preview' };

describe('protected Client execution ACL', () => {
  it('adds only execution and occurrence lifecycle to Client, preserving Coach and source PLAN', () => {
    expect(overlay).toEqual(CLIENT_SESSION_ROLE_OVERLAY);
    expect(EXPECTED_CLIENT_SESSION_ROLES.coach).toEqual(EXPECTED_CANCELLATION_ROLES.coach);
    const expected = structuredClone(EXPECTED_CANCELLATION_ROLES.client);
    expected.permissions.add.push(...overlay.roles.client.permissions.add);
    Object.assign(expected.permissions.update, overlay.roles.client.permissions.update, {
      workoutOccurrences: [...EXPECTED_CANCELLATION_ROLES.client.permissions.update.workoutOccurrences, 'status', 'workoutSessionId'],
    });
    expect(EXPECTED_CLIENT_SESSION_ROLES.client).toEqual(expected);
    for (const table of ['adHocSessions', 'adHocExercises', 'adHocSets'])
      for (const field of ['id', 'realmId', 'owner', 'creatorUserId', 'athleteUserId', 'sessionId', 'exerciseId', 'occurrencePlan'])
        expect(expected.permissions.update[table]).not.toContain(field);
    expect(expected.permissions).not.toHaveProperty('delete');
    expect(expected.permissions).not.toHaveProperty('manage');
    expect(expected.permissions.update.workoutOccurrences).not.toContain('plan');
    expect(planClientSessions(overlay, schema, roles)).toEqual({ importPayload: { roles: { client: expected } },
      changedRoles: ['client'], changeCount: 1 });
    expect(planClientSessions(overlay, schema, target()).changeCount).toBe(0);
    expect(() => verifyClientSessions(overlay, schema, roles, schema, target())).not.toThrow();
  });
  it.each([
    r => { r.roles.client.permissions.add.push('adHocSessions'); },
    r => { r.roles.client.permissions.update.workoutOccurrences.push('status'); },
    r => { r.roles.coach.permissions.update.adHocSessions.push('owner'); },
    r => { r.roles.client.permissions.delete = ['adHocSets']; },
    r => { r.roles.client.description = 'drift'; },
  ])('rejects partial or broadened installed policies', mutate => {
    const changed = structuredClone(roles); mutate(changed);
    expect(() => planClientSessions(overlay, schema, changed)).toThrow();
  });
  it('rejects manifest expansion, schema changes, configuration races and unexpected readback', () => {
    const expanded = structuredClone(overlay); expanded.roles.client.permissions.update.adHocSets.push('realmId');
    expect(() => planClientSessions(expanded, schema, roles)).toThrow('INVALID_CLIENT_SESSION_ROLE_OVERLAY');
    const incompatible = structuredClone(schema); incompatible.schema.adHocSets = 'id';
    expect(() => planClientSessions(overlay, incompatible, roles)).toThrow();
    expect(() => verifyClientSessions(overlay, schema, roles, schema, roles)).toThrow('UNEXPECTED_ROLES_READBACK');
    const drifted = target(); delete drifted.roles.unrelated;
    expect(() => verifyClientSessions(overlay, schema, roles, schema, drifted)).toThrow();
    expect(() => verifyClientSessions(overlay, schema, roles, { ...schema, marker: 'changed' }, target())).toThrow();
    expect(() => assertUnchangedBeforeApply(schema, roles, schema, target())).toThrow();
    expect(() => assertExactImportPayload({}, { data: {} })).toThrow();
  });
  it('requires owner/main manual dispatch and explicit apply confirmation', () => {
    expect(() => validateClientSessionDispatch(trusted)).not.toThrow();
    const apply = { ...trusted, DEXIE_CLIENT_SESSION_OPERATION: 'apply', DEXIE_CLIENT_SESSION_CONFIRMATION: CONFIRMATION };
    expect(() => validateClientSessionDispatch(apply)).not.toThrow();
    for (const change of [{ GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REF: 'refs/heads/feature' }, { GITHUB_ACTOR: 'other' }])
      expect(() => validateClientSessionDispatch({ ...apply, ...change })).toThrow();
    expect(() => validateClientSessionDispatch({ ...apply, DEXIE_CLIENT_SESSION_CONFIRMATION: '' })).toThrow();
    expect(() => validateClientSessionDispatch({ ...trusted, DEXIE_CLIENT_SESSION_CONFIRMATION: CONFIRMATION })).toThrow();
  });
  it('keeps writes protected and verifies full readback after failed imports and no-op apply', () => {
    const workflow = readFileSync(new URL('../../.github/workflows/dexie-client-sessions.yml', import.meta.url), 'utf8');
    expect(workflow).not.toMatch(/^\s+(push|pull_request|issues|schedule):/m);
    for (const required of ['name: dexie-production', 'group: dexie-public-catalogue-publishing',
      'secrets.DEXIE_CLOUD_WRITE_KEY', 'github.actor == github.repository_owner', 'if: always()'])
      expect(workflow).toContain(required);
    expect(workflow.indexOf('client-sessions.mjs recheck')).toBeLessThan(workflow.indexOf('dexie-cloud import client-session-proposal.json'));
    expect(workflow.match(/if: \$\{\{ !cancelled\(\)/g)).toHaveLength(2);
    expect(workflow).toContain("steps.plan.outputs.change_count == '0'");
    expect(workflow).toContain("steps.import_attempt.outputs.attempted == 'true'");
    expect(workflow).toContain('client-sessions.mjs verify');
  });
});
