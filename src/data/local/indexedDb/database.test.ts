import { describe, expect, it } from 'vitest';
import { LOCAL_DATABASE_STORES_V1, localDatabaseName } from './database';

describe('localDatabaseName', () => {
  it('scopes the IndexedDB database to the authenticated app user', () => {
    expect(localDatabaseName(42)).toBe('mezfit-local:42');
    expect(localDatabaseName(43)).toBe('mezfit-local:43');
  });

  it('rejects invalid app user ids', () => {
    expect(() => localDatabaseName(0)).toThrow('INVALID_LOCAL_DATABASE_USER_ID');
    expect(() => localDatabaseName(-1)).toThrow('INVALID_LOCAL_DATABASE_USER_ID');
    expect(() => localDatabaseName(1.5)).toThrow('INVALID_LOCAL_DATABASE_USER_ID');
  });
});

describe('LOCAL_DATABASE_STORES_V1', () => {
  it('contains the MVP domain and synchronization stores', () => {
    expect(Object.keys(LOCAL_DATABASE_STORES_V1)).toEqual([
      'users',
      'coachClients',
      'exerciseDefinitions',
      'exerciseDefinitionOverrides',
      'exerciseFavourites',
      'trainingPlans',
      'programPhases',
      'programDays',
      'programExercises',
      'programSets',
      'workoutOccurrences',
      'workoutSessions',
      'sessionExercises',
      'sessionSets',
      'syncScopes',
      'syncRemoteState',
    ]);
  });
});


describe('LOCAL_DATABASE_STORES_V1 indexes', () => {
  it('enforces one override and favourite per coach-exercise pair', () => {
    expect(LOCAL_DATABASE_STORES_V1.exerciseDefinitionOverrides).toContain(
      '&[coachUserId+exerciseDefinitionId]',
    );
    expect(LOCAL_DATABASE_STORES_V1.exerciseFavourites).toContain(
      '&[coachUserId+exerciseDefinitionId]',
    );
  });

  it('indexes workout history by user and start date', () => {
    expect(LOCAL_DATABASE_STORES_V1.workoutSessions).toContain('[userId+startedAt]');
  });
});
