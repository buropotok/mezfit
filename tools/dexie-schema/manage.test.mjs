import { describe, expect, it } from 'vitest';
import { EXPECTED_TABLES, planAdditiveSchema, validateManifest, verifyAdditiveSchema } from './manage.mjs';

const manifest = { schema: Object.fromEntries(EXPECTED_TABLES.map(name => [name, '@id'])) };
const remote = { schema: { trainingPlans: '@id', realms: '@realmId' }, sealed: true };
const roles = { roles: { coach: { permissions: { manage: ['trainingPlans'] } } } };

describe('protected Dexie Cloud schema workflow', () => {
  it('accepts only eight @id declarations with no role/data injection', () => {
    expect(validateManifest(manifest)).toEqual(manifest.schema);
    for (const invalid of [
      { ...manifest, roles: roles.roles },
      { schema: { ...manifest.schema, extra: '@id' } },
      { schema: { ...manifest.schema, programDays: null } },
      { schema: { ...manifest.schema, sessionFactSets: 'id' } },
    ]) expect(() => validateManifest(invalid)).toThrow('INVALID_ADDITIVE_SCHEMA_MANIFEST');
  });

  it('generates only missing tables and supports idempotent re-run', () => {
    const original = structuredClone(remote);
    const plan = planAdditiveSchema(manifest, remote);
    expect(plan.addedNames).toEqual(EXPECTED_TABLES);
    expect(plan.missing).toEqual(manifest.schema);
    expect(remote).toEqual(original);
    expect(planAdditiveSchema(manifest, { schema: { ...remote.schema, ...manifest.schema } })
      .addedNames).toEqual([]);
  });

  it('rejects re-keying existing tables', () => {
    expect(() => planAdditiveSchema(manifest, {
      schema: { ...remote.schema, programDays: 'id' },
    })).toThrow('INCOMPATIBLE_EXISTING_SCHEMA_TABLE');
  });

  it('verifies additive schema, intact legacy keys, unchanged roles and seal', () => {
    const after = { schema: { ...remote.schema, ...manifest.schema }, sealed: true };
    expect(() => verifyAdditiveSchema(manifest, remote, after, roles, structuredClone(roles)))
      .not.toThrow();
    expect(() => verifyAdditiveSchema(manifest, remote, remote, roles, roles))
      .toThrow('INCOMPLETE_SCHEMA_IMPORT');
    expect(() => verifyAdditiveSchema(manifest, remote, {
      ...after, schema: { ...after.schema, realms: 'id' },
    }, roles, roles)).toThrow('UNEXPECTED_SCHEMA_CHANGE');
    expect(() => verifyAdditiveSchema(manifest, remote, { ...after, sealed: false }, roles, roles))
      .toThrow('SCHEMA_SEAL_CHANGED');
    expect(() => verifyAdditiveSchema(manifest, remote, after, roles,
      { roles: { coach: { permissions: { manage: '*' } } } }))
      .toThrow('ROLE_PERMISSIONS_CHANGED');
  });
});
