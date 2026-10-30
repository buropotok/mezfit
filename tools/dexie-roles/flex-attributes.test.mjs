import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXPECTED_COACHED_START_ROLES } from './coached-start.mjs';
import {
  FLEX_ROLE_OVERLAY, FLEX_SCHEMA, EXPECTED_FLEX_ROLES, CONFIRMATION,
  assertFlexManifests, assertFlexUnchanged, buildExpectedFlexRoles,
  planFlexAttributes, validateFlexDispatch, verifyFlexAttributes,
} from './flex-attributes.mjs';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const overlay = read('../../cloud/flex-attributes-roles.json');
const manifest = read('../../cloud/schema-flex-attributes.json');
const schema = { sealed: true, schema: { trainingPlans: '@id', existing: 'id' }, metadata: { keep: true } };
const roles = { roles: { ...structuredClone(EXPECTED_COACHED_START_ROLES), extra: { permissions: { add: ['existing'] } } }, metadata: 'keep' };
const afterSchema = () => ({ ...structuredClone(schema), schema: { ...schema.schema, ...FLEX_SCHEMA.schema } });
const afterRoles = () => ({ ...structuredClone(roles), roles: { ...structuredClone(roles.roles),
  coach: structuredClone(EXPECTED_FLEX_ROLES.coach), client: structuredClone(EXPECTED_FLEX_ROLES.client) } });
const plan = (s = schema, r = roles) => planFlexAttributes(overlay, manifest, s, r);
const trusted = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
  GITHUB_ACTOR: 'buropotok', GITHUB_REPOSITORY_OWNER: 'buropotok',
  DEXIE_FLEX_OPERATION: 'apply', DEXIE_FLEX_CONFIRMATION: CONFIRMATION };

describe('protected Flex Attributes schema and ACL', () => {
  it('pins both manifests and the entire previous Coach coached-start ACL baseline', () => {
    expect(() => assertFlexManifests(overlay, manifest)).not.toThrow();
    expect(overlay).toEqual(FLEX_ROLE_OVERLAY);
    expect(manifest).toEqual(FLEX_SCHEMA);
    expect(buildExpectedFlexRoles()).toEqual(EXPECTED_FLEX_ROLES);
    const invalid = structuredClone(EXPECTED_COACHED_START_ROLES);
    invalid.client.permissions.add.push('sessionSetFacts');
    expect(() => buildExpectedFlexRoles(invalid)).toThrow('UNEXPECTED_FLEX_BASELINE');
    expect(Object.isFrozen(EXPECTED_FLEX_ROLES.coach.permissions.add)).toBe(true);
  });

  it('only adds two approved tables and append-only add/value-only update grants', () => {
    const result = plan();
    expect(result.addedTables).toEqual(['flexAttributes', 'flexValues']);
    expect(result.changedRoles).toEqual(['coach', 'client']);
    expect(result.importPayload).toEqual({ schema: FLEX_SCHEMA.schema,
      roles: { coach: EXPECTED_FLEX_ROLES.coach, client: EXPECTED_FLEX_ROLES.client } });
    for (const name of ['coach', 'client']) {
      const permission = EXPECTED_FLEX_ROLES[name].permissions;
      expect(permission.add).toEqual([...EXPECTED_COACHED_START_ROLES[name].permissions.add,
        'flexAttributes', 'flexValues']);
      expect(permission.update.flexValues).toEqual(['value']);
      expect(permission.update.flexAttributes).toBeUndefined();
      expect(permission.manage).toEqual(EXPECTED_COACHED_START_ROLES[name].permissions.manage);
      expect(permission.delete).toBeUndefined();
    }
  });

  it('rejects drift, incompatible tables and arbitrary additions to manifests', () => {
    const modifiedRoles = structuredClone(roles);
    modifiedRoles.roles.coach.permissions.update.flexValues = ['realmId'];
    expect(() => plan(schema, modifiedRoles)).toThrow('UNEXPECTED_FLEX_ROLE_BASELINE');
    const wrong = afterSchema();
    wrong.schema.flexValues = '@id';
    expect(() => plan(wrong)).toThrow('INCOMPATIBLE_FLEX_TABLE');
    expect(() => planFlexAttributes({ ...overlay, data: [] }, manifest, schema, roles))
      .toThrow('INVALID_FLEX_ROLE_MANIFEST');
    expect(() => planFlexAttributes(overlay, { schema: { ...manifest.schema, extra: 'id' } }, schema, roles))
      .toThrow('INVALID_FLEX_SCHEMA_MANIFEST');
    expect(() => plan(null, roles)).toThrow('INVALID_FLEX_CLOUD_EXPORT');
  });

  it('supports no-op and interrupted additive configuration import', () => {
    expect(plan(afterSchema(), afterRoles()).changeCount).toBe(0);
    expect(plan(afterSchema(), roles).changedRoles).toEqual(['coach', 'client']);
    expect(plan(schema, afterRoles()).addedTables).toEqual(['flexAttributes', 'flexValues']);
    const partial = afterRoles();
    partial.roles.client = structuredClone(EXPECTED_COACHED_START_ROLES.client);
    expect(plan(afterSchema(), partial).changedRoles).toEqual(['client']);
  });

  it('verifies entire remote configuration and refuses concurrent change', () => {
    expect(() => verifyFlexAttributes(overlay, manifest, schema, roles, afterSchema(), afterRoles()))
      .not.toThrow();
    const extra = afterSchema();
    extra.schema.unapproved = 'id';
    expect(() => verifyFlexAttributes(overlay, manifest, schema, roles, extra, afterRoles()))
      .toThrow('UNEXPECTED_FLEX_SCHEMA_READBACK');
    const privilege = afterRoles();
    privilege.roles.client.permissions.update.flexValues.push('owner');
    expect(() => verifyFlexAttributes(overlay, manifest, schema, roles, afterSchema(), privilege))
      .toThrow('UNEXPECTED_FLEX_ROLES_READBACK');
    expect(() => assertFlexUnchanged(schema, roles, afterSchema(), roles))
      .toThrow('FLEX_CLOUD_CONFIGURATION_CHANGED');
    expect(() => assertFlexUnchanged(schema, roles, schema, afterRoles()))
      .toThrow('FLEX_CLOUD_CONFIGURATION_CHANGED');
  });

  it('allows only manual owner/main dispatch and explicit apply confirmation', () => {
    expect(() => validateFlexDispatch(trusted)).not.toThrow();
    expect(() => validateFlexDispatch({ ...trusted, DEXIE_FLEX_OPERATION: 'preview', DEXIE_FLEX_CONFIRMATION: '' }))
      .not.toThrow();
    for (const delta of [{ GITHUB_EVENT_NAME: 'push' }, { GITHUB_REF: 'refs/heads/feature' },
      { GITHUB_ACTOR: 'other' }, { DEXIE_FLEX_OPERATION: 'bad' }, { DEXIE_FLEX_CONFIRMATION: '' },
      { DEXIE_FLEX_OPERATION: 'preview' }]) {
      expect(() => validateFlexDispatch({ ...trusted, ...delta })).toThrow();
    }
  });

  it('keeps secret and imports behind environment protection and exact after-import verification', () => {
    const workflow = readFileSync(new URL('../../.github/workflows/dexie-flex-attributes.yml', import.meta.url), 'utf8');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('name: dexie-production');
    expect(workflow).toContain('secrets.DEXIE_CLOUD_WRITE_KEY');
    expect(workflow).toContain('group: dexie-public-catalogue-publishing');
    expect(workflow).toContain('!cancelled()');
    expect(workflow).toContain('flex-attributes.mjs recheck');
    expect(workflow).toContain('flex-attributes.mjs verify');
    expect(workflow).not.toContain('pull_request:');
    expect(workflow).not.toContain('  push:');
  });
});
