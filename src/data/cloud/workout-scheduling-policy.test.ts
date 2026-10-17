import { describe, expect, it } from 'vitest';
import roleConfig from '../../../cloud/roles.json';
import { assertRolePolicy } from '../../../tools/dexie-cloud-relationship.mjs';
import { CLOUD_DATABASE_STORES_V8, CLOUD_DATABASE_VERSION } from './database';

const roles = roleConfig.roles;
function remoteRoles() {
  return (['coach', 'client'] as const).map(name => ({
    realmId: 'rlm-public', name, permissions: structuredClone(roles[name].permissions),
  }));
}

describe('scheduling ACL and schema rollout', () => {
  it('adds only the request table to both roles without lifecycle mutation rights', () => {
    expect(roles.coach.permissions.add).toEqual(['workoutScheduleRequests']);
    expect(roles.client.permissions.add).toEqual(['workoutScheduleRequests']);
    expect(roles.coach.permissions.manage).toEqual([
      'trainingPlans', 'programPhases', 'programDays', 'programExercises', 'programSets',
    ]);
    expect(JSON.stringify(roles)).not.toContain('"workoutOccurrences"');
    expect(JSON.stringify(roles)).not.toContain('"workoutSessions"');
    expect(roles.client.permissions).not.toHaveProperty('manage');
    expect(roles.coach.permissions.update).toHaveProperty('sessionSetFacts');
    expect(roles.client.permissions.update).toHaveProperty('sessionSetFacts');
  });

  it('recognizes existing and updated roles while rejecting unreviewed permissions', () => {
    const current = remoteRoles();
    expect(() => assertRolePolicy(current, roles)).not.toThrow();
    const legacy = remoteRoles();
    for (const row of legacy) {
      const permissions: Record<string, unknown> = row.permissions;
      delete permissions.add;
    }
    expect(() => assertRolePolicy(legacy, roles)).not.toThrow();
    const excessive = remoteRoles();
    (excessive[1].permissions.add as string[]).push('workoutOccurrences');
    expect(() => assertRolePolicy(excessive, roles)).toThrow('CLOUD_ROLE_MISMATCH');
  });

  it('preserves v7 stores while adding a dedicated request index in v8', () => {
    expect(CLOUD_DATABASE_VERSION).toBe(8);
    expect(CLOUD_DATABASE_STORES_V8.workoutScheduleRequests).toContain('@id');
    expect(CLOUD_DATABASE_STORES_V8.workoutScheduleRequests).toContain('&requestKey');
    expect(CLOUD_DATABASE_STORES_V8.workoutOccurrences).toContain('[realmId+calendarDate]');
    expect(CLOUD_DATABASE_STORES_V8.trainingPlans).toContain('realmId');
    expect(CLOUD_DATABASE_STORES_V8.sessionSetFacts).toContain('sessionSetId');
  });
});
