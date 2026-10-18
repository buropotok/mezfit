import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { planAdditiveSchema, validateManifest, verifyAdditiveSchema } from './manage.mjs';

const manifest = JSON.parse(readFileSync(new URL('../../cloud/schema-scheduling-foundation.json', import.meta.url), 'utf8'));
const target = 'scheduling_v1';
const before = { schema: { realms: '@realmId', workoutOccurrences: '@id' }, sealed: true };
const roles = { roles: { coach: { permissions: { manage: ['trainingPlans'] } } } };

describe('protected scheduling schema rollout', () => {
  it('accepts only the exact user-supplied ID table, without privilege or data injection', () => {
    expect(validateManifest(manifest, target)).toEqual({ workoutScheduleRequests: 'id' });
    for (const invalid of [
      { schema: { workoutScheduleRequests: '@id' } },
      { schema: { workoutScheduleRequests: 'id', workoutSessions: 'id' } },
      { schema: { workoutScheduleRequests: 'id' }, roles },
      { schema: { workoutScheduleRequests: '&requestKey' } },
    ]) expect(() => validateManifest(invalid, target)).toThrow('INVALID_ADDITIVE_SCHEMA_MANIFEST');
    expect(() => validateManifest(manifest, 'anything')).toThrow('INVALID_ADDITIVE_SCHEMA_MANIFEST');
  });

  it('creates only the absent request table and leaves other cloud records and roles unchanged', () => {
    const snapshot = structuredClone(before);
    const plan = planAdditiveSchema(manifest, before, target);
    expect(plan).toEqual({
      missing: { workoutScheduleRequests: 'id' }, addedNames: ['workoutScheduleRequests'],
    });
    expect(before).toEqual(snapshot);
    const after = { ...before, schema: { ...before.schema, ...plan.missing } };
    expect(planAdditiveSchema(manifest, after, target).addedNames).toEqual([]);
    expect(() => verifyAdditiveSchema(manifest, before, after, roles, structuredClone(roles), target))
      .not.toThrow();
    expect(() => planAdditiveSchema(manifest, {
      schema: { ...before.schema, workoutScheduleRequests: '@id' },
    }, target)).toThrow('INCOMPATIBLE_EXISTING_SCHEMA_TABLE');
    expect(() => verifyAdditiveSchema(manifest, before, {
      ...after, schema: { ...after.schema, realms: 'id' },
    }, roles, roles, target)).toThrow('UNEXPECTED_SCHEMA_CHANGE');
    expect(() => verifyAdditiveSchema(manifest, before, after, roles,
      { roles: { coach: { permissions: { manage: ['workoutOccurrences'] } } } }, target))
      .toThrow('ROLE_PERMISSIONS_CHANGED');
  });
});
