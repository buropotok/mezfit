import { describe, expect, it } from 'vitest';
import roleConfig from '../../../cloud/roles.json';
import { CLOUD_DATABASE_STORES_V8, CLOUD_DATABASE_VERSION } from './database';

const roles = roleConfig.roles;

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

  it('preserves v7 stores while adding a dedicated request index in v8', () => {
    expect(CLOUD_DATABASE_VERSION).toBe(8);
    expect(CLOUD_DATABASE_STORES_V8.workoutScheduleRequests).toContain('@id');
    expect(CLOUD_DATABASE_STORES_V8.workoutScheduleRequests).toContain('&requestKey');
    expect(CLOUD_DATABASE_STORES_V8.workoutOccurrences).toContain('[realmId+calendarDate]');
    expect(CLOUD_DATABASE_STORES_V8.trainingPlans).toContain('realmId');
    expect(CLOUD_DATABASE_STORES_V8.sessionSetFacts).toContain('sessionSetId');
  });
});
