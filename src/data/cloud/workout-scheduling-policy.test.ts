import { describe, expect, it } from 'vitest';
import roleConfig from '../../../cloud/roles.json';
import { CLOUD_DATABASE_STORES_V8, CLOUD_DATABASE_VERSION, isSchedulingSchemaEnabled } from './database';

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

  it('keeps the new Dexie Cloud schema disabled unless explicitly enabled', () => {
    for (const value of [undefined, null, '', 'false', '0', true, 'TRUE']) {
      expect(isSchedulingSchemaEnabled(value)).toBe(false);
    }
    expect(isSchedulingSchemaEnabled('true')).toBe(true);
  });

  it('preserves v7 stores while adding a dedicated request index in v8', () => {
    expect(CLOUD_DATABASE_VERSION).toBe(8);
    expect(CLOUD_DATABASE_STORES_V8.workoutScheduleRequests).toMatch(/^id,/);
    expect(CLOUD_DATABASE_STORES_V8.workoutScheduleRequests).toContain('requestKey');
    expect(CLOUD_DATABASE_STORES_V8.workoutScheduleRequests).not.toContain('&requestKey');
    expect(CLOUD_DATABASE_STORES_V8.workoutOccurrences).toContain('[realmId+calendarDate]');
    expect(CLOUD_DATABASE_STORES_V8.trainingPlans).toContain('realmId');
    expect(CLOUD_DATABASE_STORES_V8.sessionSetFacts).toContain('sessionSetId');
  });
});
