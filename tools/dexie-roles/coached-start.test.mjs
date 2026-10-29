import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ADHOC_SCHEMA } from './adhoc-sessions.mjs';
import { EXPECTED_CLIENT_SESSION_ROLES } from './client-sessions.mjs';
import { CONFIRMATION, EXPECTED_COACHED_START_ROLES, planCoachedStart, verifyCoachedStart,
  validateCoachedStartDispatch, assertUnchangedBeforeApply, assertExactImportPayload } from './coached-start.mjs';

const overlay = JSON.parse(readFileSync(new URL('../../cloud/coached-start-roles.json', import.meta.url), 'utf8'));
const schema = { schema: { workoutOccurrences: '@id', ...ADHOC_SCHEMA.schema }, marker: 'retained' };
const roles = { roles: { ...structuredClone(EXPECTED_CLIENT_SESSION_ROLES), other: { marker: 'retained' } } };
const target = () => ({ roles: { ...structuredClone(roles.roles), coach: structuredClone(EXPECTED_COACHED_START_ROLES.coach) } });
const trusted = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
  GITHUB_ACTOR: 'buropotok', GITHUB_REPOSITORY_OWNER: 'buropotok', DEXIE_COACHED_START_OPERATION: 'preview' };

describe('protected Coach format ACL', () => {
  it('adds only format to Coach and preserves Client, identity, PLAN and FACT grants', () => {
    const expected = structuredClone(EXPECTED_CLIENT_SESSION_ROLES);
    expected.coach.permissions.update.workoutOccurrences.push('format');
    expect(EXPECTED_COACHED_START_ROLES).toEqual(expected);
    expect(planCoachedStart(overlay, schema, roles)).toEqual({
      importPayload: { roles: { coach: expected.coach } }, changedRoles: ['coach'], changeCount: 1,
    });
    expect(planCoachedStart(overlay, schema, target()).changeCount).toBe(0);
    expect(() => verifyCoachedStart(overlay, schema, roles, schema, target())).not.toThrow();
  });
  it('rejects expanded manifests, incomplete profiles, races and unexpected full readback', () => {
    const expanded = structuredClone(overlay);
    expanded.roles.coach.permissions.update.workoutOccurrences.push('athleteUserId');
    expect(() => planCoachedStart(expanded, schema, roles)).toThrow();
    for (const mutate of [
      r => r.roles.client.permissions.update.workoutOccurrences.push('format'),
      r => r.roles.coach.permissions.update.adHocSessions.push('owner'),
      r => r.roles.coach.permissions.update.workoutOccurrences.pop(),
    ]) {
      const changed = structuredClone(roles); mutate(changed);
      expect(() => planCoachedStart(overlay, schema, changed)).toThrow();
    }
    expect(() => assertUnchangedBeforeApply(schema, roles, schema, target())).toThrow();
    expect(() => assertExactImportPayload({}, { roles: {} })).toThrow();
    expect(() => verifyCoachedStart(overlay, schema, roles, schema, roles)).toThrow();
    const drifted = target(); delete drifted.roles.other;
    expect(() => verifyCoachedStart(overlay, schema, roles, schema, drifted)).toThrow();
    expect(() => verifyCoachedStart(overlay, schema, roles, { ...schema, marker: 'changed' }, target())).toThrow();
  });
  it('requires manual main owner dispatch, explicit apply and protected full readback', () => {
    expect(() => validateCoachedStartDispatch(trusted)).not.toThrow();
    const apply = { ...trusted, DEXIE_COACHED_START_OPERATION: 'apply', DEXIE_COACHED_START_CONFIRMATION: CONFIRMATION };
    expect(() => validateCoachedStartDispatch(apply)).not.toThrow();
    for (const change of [{ GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REF: 'refs/heads/feature' },
      { GITHUB_ACTOR: 'other' }, { DEXIE_COACHED_START_CONFIRMATION: '' }])
      expect(() => validateCoachedStartDispatch({ ...apply, ...change })).toThrow();
    const workflow = readFileSync(new URL('../../.github/workflows/dexie-coached-start.yml', import.meta.url), 'utf8');
    expect(workflow).not.toMatch(/^\s+(push|pull_request|issues|schedule):/m);
    for (const required of ['name: dexie-production', 'group: dexie-public-catalogue-publishing',
      'secrets.DEXIE_CLOUD_WRITE_KEY', 'github.actor == github.repository_owner', 'if: always()'])
      expect(workflow).toContain(required);
    expect(workflow.indexOf('coached-start.mjs recheck')).toBeLessThan(workflow.indexOf('dexie-cloud import coached-start-proposal.json'));
    expect(workflow.match(/if: \$\{\{ !cancelled\(\)/g)).toHaveLength(2);
    expect(workflow).toContain("steps.plan.outputs.change_count == '0'");
    expect(workflow).toContain("steps.import_attempt.outputs.attempted == 'true'");
  });
});
