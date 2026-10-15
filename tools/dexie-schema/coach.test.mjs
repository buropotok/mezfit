import { describe, expect, it } from 'vitest';
import {
  COACH_SCHEMA_TABLES,
  planCoachSchema, validateCoachSchemaManifest, verifyCoachSchema,
} from './coach.mjs';

const manifest = { schema: {
  coachExerciseOverrides: 'id',
  coachExerciseDefinitions: 'id',
  coachExerciseFavourites: 'id',
} };
const remote = {
  schema: { trainingPlans: '@id', realms: '@realmId', publicExerciseDefinitions: 'id' },
  sealed: false,
};
const roles = { roles: { coach: { permissions: { manage: ['trainingPlans'] } }, client: { permissions: {} } } };

describe('protected coach exercise schema publication', () => {
  it('allows only the three approved id-keyed tables with no roles, data or wildcard', () => {
    expect(COACH_SCHEMA_TABLES).toEqual(Object.keys(manifest.schema));
    expect(validateCoachSchemaManifest(manifest)).toEqual(manifest.schema);
    for (const invalid of [
      { ...manifest, roles: roles.roles },
      { schema: { ...manifest.schema, evilTable: 'id' } },
      { schema: { ...manifest.schema, coachExerciseOverrides: '@id' } },
      { schema: { ...manifest.schema, coachExerciseFavourites: null } },
      { schema: [manifest.schema] },
      { schema: { coachExerciseOverrides: 'id' } },
    ]) {
      expect(() => validateCoachSchemaManifest(invalid)).toThrow('INVALID_COACH_SCHEMA_MANIFEST');
    }
  });

  it('plans only missing coach tables and is idempotent after an existing installation', () => {
    const unchanged = structuredClone(remote);
    const plan = planCoachSchema(manifest, remote);
    expect(plan.addedNames).toEqual(COACH_SCHEMA_TABLES);
    expect(plan.missing).toEqual(manifest.schema);
    expect(remote).toEqual(unchanged);
    expect(planCoachSchema(manifest, {
      ...remote, schema: { ...remote.schema, ...manifest.schema },
    }).addedNames).toEqual([]);
  });

  it('will not overwrite a preexisting incompatible key or consume an invalid export', () => {
    expect(() => planCoachSchema(manifest, {
      ...remote, schema: { ...remote.schema, coachExerciseOverrides: '@id' },
    })).toThrow('INCOMPATIBLE_EXISTING_COACH_TABLE');
    expect(() => planCoachSchema(manifest, { schema: { bad: null } }))
      .toThrow('INVALID_REMOTE_COACH_SCHEMA');
  });

  it('verifies complete import and forbids changes to existing tables, roles and seal', () => {
    const after = { ...remote, schema: { ...remote.schema, ...manifest.schema } };
    expect(() => verifyCoachSchema(manifest, remote, after, roles, structuredClone(roles))).not.toThrow();
    expect(() => verifyCoachSchema(manifest, remote, remote, roles, roles))
      .toThrow('INCOMPLETE_COACH_SCHEMA_IMPORT');
    expect(() => verifyCoachSchema(manifest, remote, {
      ...after, schema: { ...after.schema, trainingPlans: 'id' },
    }, roles, roles)).toThrow('UNEXPECTED_COACH_SCHEMA_CHANGE');
    expect(() => verifyCoachSchema(manifest, remote, {
      ...after, schema: { ...after.schema, unexpectedTable: 'id' },
    }, roles, roles)).toThrow('UNEXPECTED_COACH_SCHEMA_CHANGE');
    expect(() => verifyCoachSchema(manifest, remote, { ...after, sealed: true }, roles, roles))
      .toThrow('COACH_SCHEMA_SEAL_CHANGED');
    expect(() => verifyCoachSchema(manifest, remote, after, roles, {
      roles: { coach: { permissions: { manage: '*' } } },
    })).toThrow('COACH_ROLE_PERMISSIONS_CHANGED');
  });

  it('accepts a repeated apply that makes no schema changes', () => {
    const complete = { ...remote, schema: { ...remote.schema, ...manifest.schema } };
    expect(() => verifyCoachSchema(manifest, complete, structuredClone(complete), roles, roles)).not.toThrow();
  });
});
