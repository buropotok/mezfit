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


describe('LOCAL_DATABASE_STORES_V1 server alignment', () => {
  it('mirrors unconditional D1 uniqueness constraints that IndexedDB can represent directly', () => {
    expect(LOCAL_DATABASE_STORES_V1.users).toContain('&telegramUserId');
    expect(LOCAL_DATABASE_STORES_V1.coachClients).toContain('&[coachUserId+clientUserId]');
    expect(LOCAL_DATABASE_STORES_V1.coachClients).toContain('&inviteId');
    expect(LOCAL_DATABASE_STORES_V1.exerciseDefinitions).toContain(
      '&[referenceSource+referenceKey]',
    );
    expect(LOCAL_DATABASE_STORES_V1.programPhases).toContain(
      '&[trainingPlanId+position]',
    );
    expect(LOCAL_DATABASE_STORES_V1.workoutSessions).toContain('&occurrenceId');
    expect(LOCAL_DATABASE_STORES_V1.sessionExercises).toContain(
      '&[workoutSessionId+position]',
    );
    expect(LOCAL_DATABASE_STORES_V1.sessionSets).toContain(
      '&[sessionExerciseId+position]',
    );
  });

  it('keeps server partial position constraints non-unique locally', () => {
    expect(LOCAL_DATABASE_STORES_V1.programDays).toContain(
      '[programPhaseId+status+position]',
    );
    expect(LOCAL_DATABASE_STORES_V1.programDays).not.toContain(
      '&[programPhaseId+position]',
    );
    expect(LOCAL_DATABASE_STORES_V1.programExercises).not.toContain(
      '&[programDayId+position]',
    );
    expect(LOCAL_DATABASE_STORES_V1.programSets).not.toContain(
      '&[programExerciseId+position]',
    );
  });

  it('indexes the server hot read paths used by client lists, programs, calendar, and workout facts', () => {
    expect(LOCAL_DATABASE_STORES_V1.coachClients).toContain('[coachUserId+status]');
    expect(LOCAL_DATABASE_STORES_V1.coachClients).toContain('[clientUserId+status]');
    expect(LOCAL_DATABASE_STORES_V1.trainingPlans).toContain('[userId+position]');
    expect(LOCAL_DATABASE_STORES_V1.programPhases).toContain(
      '[trainingPlanId+status+position]',
    );
    expect(LOCAL_DATABASE_STORES_V1.programDays).toContain(
      '[programPhaseId+status+position]',
    );
    expect(LOCAL_DATABASE_STORES_V1.programExercises).toContain(
      '[programDayId+status+position]',
    );
    expect(LOCAL_DATABASE_STORES_V1.programSets).toContain(
      '[programExerciseId+status+position]',
    );
    expect(LOCAL_DATABASE_STORES_V1.workoutOccurrences).toContain(
      '[clientUserId+calendarDateKey+startMinute]',
    );
    expect(LOCAL_DATABASE_STORES_V1.workoutOccurrences).toContain(
      '[coachUserId+calendarDateKey+startMinute]',
    );
    expect(LOCAL_DATABASE_STORES_V1.sessionExercises).toContain(
      '[workoutSessionId+status+position]',
    );
    expect(LOCAL_DATABASE_STORES_V1.sessionSets).toContain(
      '[sessionExerciseId+status+position]',
    );
  });
});
