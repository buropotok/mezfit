import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertApprovedManifest, planSchedulingAcl, validateAclDispatch, verifySchedulingAcl, assertUnchangedBeforeApply } from './local-calendar.mjs';
const manifest = JSON.parse(readFileSync(new URL('../../cloud/roles.json', import.meta.url), 'utf8'));
const previous = structuredClone(manifest);
for (const [name, role] of Object.entries(previous.roles)) {
  delete role.permissions.add;
  delete role.permissions.update.workoutOccurrences;
  role.description = name === 'coach'
    ? 'Can author assigned PLAN and edit set FACT; session lifecycle stays privileged'
    : 'Can read assigned PLAN and edit only set FACT; session lifecycle stays privileged';
}
const schema = { sealed: true, schema: { workoutOccurrences: '@id' } };
const trusted = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
  GITHUB_ACTOR: 'buropotok', GITHUB_REPOSITORY_OWNER: 'buropotok',
  DEXIE_ACL_OPERATION: 'apply', DEXIE_ACL_CONFIRMATION: 'APPLY_LOCAL_CALENDAR_COACH_CLIENT_ACL' };
describe('protected local calendar ACL', () => {
  it('accepts only the reviewed table and field grants and exact installed baseline', () => {
    expect(assertApprovedManifest(manifest)).toEqual(manifest.roles);
    const changed = structuredClone(manifest); changed.roles.client.permissions.manage = ['workoutOccurrences'];
    expect(() => assertApprovedManifest(changed)).toThrow();
    expect(planSchedulingAcl(manifest, schema, previous).changedNames).toEqual(['coach', 'client']);
    expect(planSchedulingAcl(manifest, schema, manifest).changedNames).toEqual([]);
    const unexpected = structuredClone(previous); unexpected.roles.client.permissions.add = ['workoutSessions'];
    expect(() => planSchedulingAcl(manifest, schema, unexpected)).toThrow();
  });
  it('preserves source PLAN, FACT, schema and unrelated roles', () => {
    const before = { roles: { ...previous.roles, unrelated: { permissions: {} } } };
    const after = { roles: { ...manifest.roles, unrelated: { permissions: {} } } };
    expect(() => verifySchedulingAcl(manifest, schema, before, schema, after)).not.toThrow();
    expect(() => verifySchedulingAcl(manifest, schema, before, { schema: {} }, after)).toThrow();
    expect(() => assertUnchangedBeforeApply(schema, before, schema, after)).toThrow();
  });
  it('requires protected main/owner manual dispatch and explicit confirmation', () => {
    expect(() => validateAclDispatch(trusted)).not.toThrow();
    for (const invalid of [{ GITHUB_EVENT_NAME: 'push' }, { GITHUB_REF: 'refs/heads/feature' },
      { GITHUB_ACTOR: 'outsider' }, { DEXIE_ACL_CONFIRMATION: '' }])
      expect(() => validateAclDispatch({ ...trusted, ...invalid })).toThrow();
    const workflow = readFileSync(new URL('../../.github/workflows/dexie-local-calendar-acl.yml', import.meta.url), 'utf8');
    expect(workflow).toContain('name: dexie-production');
    expect(workflow).not.toMatch(/^\s+(push|pull_request):/m);
    expect(workflow).toContain('local-calendar.mjs recheck');
    expect(workflow).toContain('local-calendar.mjs verify');
    expect(workflow).toContain('!cancelled()');
  });
});
