import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXPECTED_FLEX_ROLES } from './flex-attributes.mjs';
import {
  CONFIRMATION, OVERLAY, addRepeatPermission, planRepeatAcl,
  verifyRepeatAcl, validateDispatch,
} from './calendar-repeat.mjs';

const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const manifest = read('../../cloud/calendar-repeat-roles.json');
const schema = { sealed: true, schema: { workoutOccurrences: '@id', extra: 'id' }, metadata: 'keep' };
const base = () => ({ roles: { ...structuredClone(EXPECTED_FLEX_ROLES),
  unrelated: { permissions: { add: ['someOtherTable'] } } }, metadata: 'keep' });
const target = () => {
  const b = base();
  const expanded = addRepeatPermission(EXPECTED_FLEX_ROLES);
  b.roles.coach = expanded.coach; b.roles.client = expanded.client;
  return b;
};
const allowed = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
  GITHUB_ACTOR: 'buropotok', GITHUB_REPOSITORY_OWNER: 'buropotok',
  REPEAT_OPERATION: 'apply', REPEAT_CONFIRMATION: CONFIRMATION };

describe('protected calendar repetition ACL operator', () => {
  it('pins the exact per-field overlay and preserves every existing grant', () => {
    expect(manifest).toEqual(OVERLAY);
    const delta = planRepeatAcl(manifest, schema, base());
    expect(delta.changed).toEqual(['coach', 'client']);
    expect(delta.payload).toEqual({ roles: {
      coach: target().roles.coach, client: target().roles.client,
    } });
    for (const user of ['coach', 'client']) {
      const from = structuredClone(EXPECTED_FLEX_ROLES[user]);
      const updated = delta.payload.roles[user];
      expect(updated.permissions.update.workoutOccurrences).toEqual([
        ...from.permissions.update.workoutOccurrences, 'pendingRepeatRule',
      ]);
      from.permissions.update.workoutOccurrences.push('pendingRepeatRule');
      expect(updated).toEqual(from);
      expect(updated.permissions.delete).toBeUndefined();
    }
  });

  it('is idempotent and tolerates one-role applied imports only', () => {
    expect(planRepeatAcl(manifest, schema, target()).changed).toEqual([]);
    const half = base();
    half.roles.client = target().roles.client;
    const delta = planRepeatAcl(manifest, schema, half);
    expect(delta.changed).toEqual(['coach']);
    expect(delta.payload.roles.client).toBeUndefined();
    verifyRepeatAcl(manifest, schema, half, schema, target(), true);
  });

  it('fails closed on unknown grants, unexpected schema and tampered manifest', () => {
    const drift = base();
    drift.roles.coach.permissions.update.workoutOccurrences.push('owner');
    expect(() => planRepeatAcl(manifest, schema, drift)).toThrow('UNEXPECTED_REPEAT_ACL_BASELINE');
    const mismatch = structuredClone(schema);
    mismatch.schema.workoutOccurrences = 'id';
    expect(() => planRepeatAcl(manifest, mismatch, base())).toThrow('INVALID_REPEAT_CLOUD_EXPORT');
    expect(() => planRepeatAcl({ ...manifest, roles: { ...manifest.roles,
      coach: { permissions: { update: { workoutOccurrences: ['owner'] } } } } }, schema, base()))
      .toThrow('INVALID_REPEAT_MANIFEST');
  });

  it('verifies full schema and all roles after apply and after preview', () => {
    verifyRepeatAcl(manifest, schema, base(), schema, target(), true);
    verifyRepeatAcl(manifest, schema, base(), schema, base(), false);
    const extraRole = target();
    extraRole.roles.unrelated.permissions.add.push('anotherTable');
    expect(() => verifyRepeatAcl(manifest, schema, base(), schema, extraRole, true))
      .toThrow('UNEXPECTED_REPEAT_ROLES_CHANGE');
    expect(() => verifyRepeatAcl(manifest, schema, base(),
      { ...schema, sealed: false }, target(), true)).toThrow('UNEXPECTED_REPEAT_SCHEMA_CHANGE');
    expect(() => verifyRepeatAcl(manifest, schema, base(), schema, target(), false))
      .toThrow('UNEXPECTED_REPEAT_ROLES_CHANGE');
  });

  it('allows only manual owner/main and explicit apply confirmation', () => {
    expect(() => validateDispatch(allowed)).not.toThrow();
    expect(() => validateDispatch({ ...allowed,
      REPEAT_OPERATION: 'preview', REPEAT_CONFIRMATION: '' })).not.toThrow();
    for (const wrong of [{ GITHUB_EVENT_NAME: 'push' },
      { GITHUB_REF: 'refs/heads/feature' }, { GITHUB_ACTOR: 'other' },
      { REPEAT_CONFIRMATION: '' }, { REPEAT_OPERATION: 'preview' },
      { REPEAT_OPERATION: 'unknown' }]) {
      expect(() => validateDispatch({ ...allowed, ...wrong })).toThrow();
    }
  });

  it('locks import and secret behind the protected manually dispatched workflow', () => {
    const workflow = readFileSync(new URL('../../.github/workflows/dexie-calendar-repeat.yml', import.meta.url), 'utf8');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('name: dexie-production');
    expect(workflow).toContain('github.actor == github.repository_owner');
    expect(workflow).toContain('group: dexie-public-catalogue-publishing');
    expect(workflow).toContain('secrets.DEXIE_CLOUD_WRITE_KEY');
    expect(workflow).toContain("if: inputs.operation == 'apply' && steps.plan.outputs.change_count != '0'");
    expect(workflow).toContain('calendar-repeat.mjs recheck');
    expect(workflow).toContain('calendar-repeat.mjs verify');
    expect(workflow).toContain('!cancelled()');
    expect(workflow).not.toContain('pull_request:');
    expect(workflow).not.toContain('  push:');
  });
});
