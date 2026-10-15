import { describe, expect, it } from 'vitest';
import { EXPECTED_TABLES, formatCloudStructureReport, planAdditiveSchema, validateManifest, verifyAdditiveSchema } from './manage.mjs';

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


describe('complete read-only Dexie Cloud structure report', () => {
  it('includes every remote table and role, not only workout v4', () => {
    const report = formatCloudStructureReport(
      { schema: { ...remote.schema, ...manifest.schema, exerciseDefinitionOverrides: '@id' }, sealed: true, secret: 'DO_NOT_PRINT' },
      { roles: { ...roles.roles, client: { permissions: { read: ['trainingPlans'] } } }, token: 'DO_NOT_PRINT' },
    );
    expect(report).toContain('exerciseDefinitionOverrides');
    expect(report).toContain('trainingPlans');
    expect(report).toContain('client');
    expect(report).toContain('Schema sealed: true');
    expect(report).not.toContain('DO_NOT_PRINT');
  });

  it('rejects malformed exports instead of silently showing incomplete structure', () => {
    expect(() => formatCloudStructureReport({ schema: [] }, roles)).toThrow('INVALID_CLOUD_STRUCTURE_EXPORT');
    expect(() => formatCloudStructureReport(remote, { roles: null })).toThrow('INVALID_CLOUD_STRUCTURE_EXPORT');
    expect(() => formatCloudStructureReport({ schema: { bad: null } }, roles)).toThrow('INVALID_CLOUD_STRUCTURE_EXPORT');
  });
});
