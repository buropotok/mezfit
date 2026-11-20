import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXPECTED_DISCUSSION_ROLES } from './discussions.mjs';
import { addRepeatPermission } from './calendar-repeat.mjs';
import { CONFIRMATION, OVERLAY, extendIndependentPlanAccess,
  planIndependentOccurrencePlan, verifyIndependentOccurrencePlan, validateDispatch } from './independent-occurrence-plan.mjs';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const manifest = read('../../cloud/independent-occurrence-plan-roles.json');
const schema = { schema: { workoutOccurrences: '@id' }, other: 'unchanged' };
const baseline = repeat => repeat ? addRepeatPermission(EXPECTED_DISCUSSION_ROLES) : structuredClone(EXPECTED_DISCUSSION_ROLES);
const state = (repeat = false) => ({ roles: { ...baseline(repeat),
  admin: { permissions: { add: ['unrelated'] } } }, metadata: 'keep' });
const updated = repeat => {
  const before = state(repeat);
  before.roles.client = extendIndependentPlanAccess(baseline(repeat)).client;
  return before;
};

describe('independent occurrence PLAN protected ACL', () => {
  it.each([false, true])('updates only Client occurrence fields with repeat=%s', repeat => {
    expect(manifest).toEqual(OVERLAY);
    const before = state(repeat), after = updated(repeat);
    const plan = planIndependentOccurrencePlan(manifest, schema, before);
    expect(plan.changed).toBe(true);
    expect(plan.payload).toEqual({ roles: { client: after.roles.client } });
    expect(plan.payload.roles.coach).toBeUndefined();
    expect(plan.payload.roles.client.permissions.update.workoutOccurrences).toEqual([
      ...before.roles.client.permissions.update.workoutOccurrences, 'plan', 'publishedPlan',
    ]);
    expect(plan.payload.roles.client.permissions.manage).toEqual(before.roles.client.permissions.manage);
    expect(plan.payload.roles.client.permissions.update.trainingPlans).toBeUndefined();
    expect(planIndependentOccurrencePlan(manifest, schema, after)).toEqual({ changed: false, payload: {} });
    verifyIndependentOccurrencePlan(manifest, schema, before, schema, after, true);
    verifyIndependentOccurrencePlan(manifest, schema, before, schema, before, false);
  });

  it('fails closed for unrecognized profiles, extra grants or malformed update lists', () => {
    const drift = state();
    drift.roles.client.permissions.update.workoutOccurrences.push('format');
    expect(() => planIndependentOccurrencePlan(manifest, schema, drift))
      .toThrow('UNEXPECTED_INDEPENDENT_PLAN_ROLE_BASELINE');
    const coachDrift = state();
    coachDrift.roles.coach.permissions.update.workoutOccurrences.push('athleteUserId');
    expect(() => planIndependentOccurrencePlan(manifest, schema, coachDrift))
      .toThrow('UNEXPECTED_INDEPENDENT_PLAN_ROLE_BASELINE');
    const duplicate = state();
    duplicate.roles.client.permissions.update.workoutOccurrences.push('updatedAt');
    expect(() => planIndependentOccurrencePlan(manifest, schema, duplicate))
      .toThrow('UNEXPECTED_INDEPENDENT_PLAN_ROLE_BASELINE');
    expect(() => planIndependentOccurrencePlan({ roles: {} }, schema, state()))
      .toThrow('INVALID_INDEPENDENT_PLAN_MANIFEST');
    expect(() => planIndependentOccurrencePlan(manifest, { schema: { workoutOccurrences: 'id' } }, state()))
      .toThrow('INVALID_INDEPENDENT_PLAN_CLOUD_EXPORT');
  });

  it('verifies every unchanged role and schema, including rejected partial imports', () => {
    const changed = updated(false);
    changed.roles.admin.permissions.add.push('extra');
    expect(() => verifyIndependentOccurrencePlan(manifest, schema, state(), schema, changed, true))
      .toThrow('UNEXPECTED_INDEPENDENT_PLAN_ROLE_CHANGE');
    expect(() => verifyIndependentOccurrencePlan(manifest, schema, state(),
      { schema: { workoutOccurrences: 'id' } }, updated(false), true))
      .toThrow('UNEXPECTED_INDEPENDENT_PLAN_SCHEMA_CHANGE');
    expect(() => verifyIndependentOccurrencePlan(manifest, schema, state(), schema, updated(false), false))
      .toThrow('UNEXPECTED_INDEPENDENT_PLAN_ROLE_CHANGE');
  });

  it('requires owner, main, manual dispatch and literal apply confirmation', () => {
    const allowed = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
      GITHUB_ACTOR: 'buropotok', GITHUB_REPOSITORY_OWNER: 'buropotok',
      INDEPENDENT_PLAN_OPERATION: 'apply', INDEPENDENT_PLAN_CONFIRMATION: CONFIRMATION };
    expect(() => validateDispatch(allowed)).not.toThrow();
    expect(() => validateDispatch({ ...allowed, INDEPENDENT_PLAN_OPERATION: 'preview',
      INDEPENDENT_PLAN_CONFIRMATION: '' })).not.toThrow();
    for (const change of [{ GITHUB_EVENT_NAME: 'push' }, { GITHUB_REF: 'refs/heads/feature' },
      { GITHUB_ACTOR: 'other' }, { INDEPENDENT_PLAN_CONFIRMATION: '' },
      { INDEPENDENT_PLAN_OPERATION: 'preview' }])
      expect(() => validateDispatch({ ...allowed, ...change })).toThrow();
  });

  it('never imports from PR/push and always reads back after an import attempt', () => {
    const workflow = readFileSync(new URL('../../.github/workflows/dexie-independent-occurrence-plan.yml', import.meta.url), 'utf8');
    for (const expected of ['workflow_dispatch:', 'name: dexie-production',
      'github.actor == github.repository_owner', 'group: dexie-public-catalogue-publishing',
      'secrets.DEXIE_CLOUD_WRITE_KEY', 'independent-occurrence-plan.mjs recheck',
      'independent-occurrence-plan.mjs verify', '!cancelled()', 'independent-plan-import.json'])
      expect(workflow).toContain(expected);
    expect(workflow).not.toContain('pull_request:');
    expect(workflow).not.toContain('  push:');
  });
});
