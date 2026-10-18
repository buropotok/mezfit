import { describe, expect, it } from 'vitest';
import roleConfig from '../../../cloud/roles.json';
import { CLOUD_DATABASE_STORES_V9, CLOUD_DATABASE_STORES_V10, CLOUD_DATABASE_VERSION } from './database';

const roles = roleConfig.roles;

describe('occurrence scheduling policy', () => {
  it('keeps lifecycle writes privileged while preserving Coach PLAN and shared FACT grants', () => {
    expect(roles.coach.permissions).not.toHaveProperty('add');
    expect(roles.client.permissions).not.toHaveProperty('add');
    expect(roles.coach.permissions.manage).toEqual([
      'trainingPlans', 'programPhases', 'programDays', 'programExercises', 'programSets',
    ]);
    expect(JSON.stringify(roles)).not.toContain('"workoutOccurrences"');
    expect(JSON.stringify(roles)).not.toContain('"workoutSessions"');
    expect(roles.client.permissions).not.toHaveProperty('manage');
    expect(roles.coach.permissions.update).toHaveProperty('sessionSetFacts');
    expect(roles.client.permissions.update).toHaveProperty('sessionSetFacts');
  });

  it('drops only the retired local intent table and retains drafts and workout data', () => {
    expect(CLOUD_DATABASE_VERSION).toBe(10);
    expect(CLOUD_DATABASE_STORES_V10.workoutScheduleRequests).toBeNull();
    const { workoutScheduleRequests: retired, ...previous } = CLOUD_DATABASE_STORES_V9;
    const { workoutScheduleRequests: removed, ...current } = CLOUD_DATABASE_STORES_V10;
    expect(retired).toMatch(/^id,/);
    expect(removed).toBeNull();
    expect(current).toEqual(previous);
    expect(current.localWorkoutOccurrenceDrafts).toContain('actorUserId');
    expect(current.workoutOccurrences).toContain('[realmId+startsAtUtc]');
  });
});
