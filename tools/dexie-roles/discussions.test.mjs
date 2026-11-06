import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { EXPECTED_FLEX_ROLES } from './flex-attributes.mjs';
import { DISCUSSION_SCHEMA, DISCUSSION_ROLE_OVERLAY, EXPECTED_DISCUSSION_ROLES, CONFIRMATION,
  planDiscussions, verifyDiscussions, assertDiscussionUnchanged, validateDiscussionDispatch } from './discussions.mjs';
const schema = { schema: { existing: 'id' }, sealed: true };
const roles = { roles: { ...structuredClone(EXPECTED_FLEX_ROLES), unrelated: { permissions: {} } } };
const plan = (s = schema, r = roles, overlay = DISCUSSION_ROLE_OVERLAY) => planDiscussions(overlay, DISCUSSION_SCHEMA, s, r);

describe('exact protected discussion schema/ACL operator', () => {
  it('plans only four additive tables and the two exact existing role overlays', () => {
    const actualOverlay = JSON.parse(readFileSync(new URL('../../cloud/discussion-roles.json', import.meta.url), 'utf8'));
    const actualSchema = JSON.parse(readFileSync(new URL('../../cloud/schema-discussions.json', import.meta.url), 'utf8'));
    expect(() => planDiscussions(actualOverlay, actualSchema, schema, roles)).not.toThrow();
    const result = plan();
    expect(result.addedTables).toEqual(['discussionThreads', 'discussionMessages', 'discussionReadStates', 'messageAttachments']);
    expect(result.changedRoles).toEqual(['coach', 'client']);
    expect(result.importPayload.roles).not.toHaveProperty('unrelated');
    const afterSchema = { ...schema, schema: { ...schema.schema, ...DISCUSSION_SCHEMA.schema } };
    const afterRoles = { roles: { ...roles.roles, ...EXPECTED_DISCUSSION_ROLES } };
    expect(() => verifyDiscussions(DISCUSSION_ROLE_OVERLAY, DISCUSSION_SCHEMA, schema, roles, afterSchema, afterRoles)).not.toThrow();
    expect(plan(afterSchema, afterRoles).changeCount).toBe(0);
  });
  it('rejects widened manifests, conflicting table keys, partial roles and altered baseline grants', () => {
    const overlay = structuredClone(DISCUSSION_ROLE_OVERLAY); overlay.roles.coach.permissions.update.discussionMessages = ['text'];
    expect(() => plan(schema, roles, overlay)).toThrow('INVALID_DISCUSSION_ROLE_MANIFEST');
    expect(() => plan({ schema: { discussionMessages: '@id' } })).toThrow('INCOMPATIBLE_DISCUSSION_TABLE');
    const partial = structuredClone(roles); partial.roles.coach = structuredClone(EXPECTED_DISCUSSION_ROLES.coach);
    expect(() => plan(schema, partial)).toThrow('UNEXPECTED_DISCUSSION_ROLE_BASELINE');
    const extra = structuredClone(roles); extra.roles.client.permissions.manage = ['trainingPlans'];
    expect(() => plan(schema, extra)).toThrow();
  });
  it('detects configuration drift and verifies readback including unrelated configuration on no-op/failed import', () => {
    expect(() => assertDiscussionUnchanged(schema, roles, { ...schema, sealed: false }, roles)).toThrow();
    const targetSchema = { ...schema, schema: { ...schema.schema, ...DISCUSSION_SCHEMA.schema } };
    const targetRoles = { roles: { ...roles.roles, ...EXPECTED_DISCUSSION_ROLES } };
    expect(() => verifyDiscussions(DISCUSSION_ROLE_OVERLAY, DISCUSSION_SCHEMA, targetSchema, targetRoles, targetSchema, roles)).toThrow();
    const wrong = structuredClone(targetRoles); wrong.roles.unrelated.permissions.manage = '*';
    expect(() => verifyDiscussions(DISCUSSION_ROLE_OVERLAY, DISCUSSION_SCHEMA, schema, roles, targetSchema, wrong)).toThrow();
  });
  it('allows preview without mutation, requires owner/main/manual + COMM-02 attestation + literal Apply', () => {
    const env = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_ACTOR: 'owner', GITHUB_REPOSITORY_OWNER: 'owner', DEXIE_DISCUSSION_OPERATION: 'preview' };
    expect(() => validateDiscussionDispatch(env)).not.toThrow();
    for (const patch of [{ GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REF: 'refs/heads/feature' }, { GITHUB_ACTOR: 'other' }])
      expect(() => validateDiscussionDispatch({ ...env, ...patch })).toThrow();
    const apply = { ...env, DEXIE_DISCUSSION_OPERATION: 'apply', DEXIE_DISCUSSION_CONFIRMATION: CONFIRMATION };
    expect(() => validateDiscussionDispatch(apply)).toThrow('COMM02_VALIDATION_REQUIRED');
    expect(() => validateDiscussionDispatch({ ...apply, DEXIE_DISCUSSION_COMM02_VALIDATED: 'true' })).not.toThrow();
    expect(() => validateDiscussionDispatch({ ...apply, DEXIE_DISCUSSION_COMM02_VALIDATED: 'true', DEXIE_DISCUSSION_CONFIRMATION: 'yes' })).toThrow();
    const workflow = readFileSync(new URL('../../.github/workflows/dexie-discussions.yml', import.meta.url), 'utf8');
    expect(workflow).toContain("if: ${{ !cancelled() && inputs.operation == 'apply'");
    expect(workflow).toContain('environment:\n      name: dexie-production');
    expect(workflow).toContain('cancel-in-progress: false');
  });
});
