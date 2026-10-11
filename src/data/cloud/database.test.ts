import { describe, expect, it } from 'vitest';
import cloudRoles from '../../../cloud/roles.json';
import {
  CLOUD_DATABASE_STORES_V1,
  type CloudSessionSetFactRow,
  cloudDatabaseName,
  sessionSetFactId,
} from './database';

describe('cloudDatabaseName', () => {
  it('keeps Cloud IndexedDB isolated by Telegram user and separate from legacy D1 cache', () => {
    expect(cloudDatabaseName('42')).toBe('mezfit-cloud:42');
    expect(cloudDatabaseName('43')).not.toBe(cloudDatabaseName('42'));
    expect(cloudDatabaseName('42')).not.toBe('mezfit-local:42');
  });

  it('rejects invalid Telegram user IDs', () => {
    for (const id of ['0', '-1', '1.5', 'fake-user']) {
      expect(() => cloudDatabaseName(id)).toThrow('INVALID_LOCAL_DATABASE_USER_ID');
    }
  });
});

describe('sessionSetFactId', () => {
  it('creates a distinct, stable FACT primary key from each globally unique PLAN set ID', () => {
    expect(sessionSetFactId('sesAb12_3')).toBe('fact:sesAb12_3');
    expect(sessionSetFactId('sesAb12_3')).toBe(sessionSetFactId('sesAb12_3'));
    expect(sessionSetFactId('sesOther')).not.toBe(sessionSetFactId('sesAb12_3'));
    expect(sessionSetFactId('sesAb12_3')).not.toBe('sesAb12_3');
    expect(() => sessionSetFactId('')).toThrow('INVALID_CLOUD_SESSION_SET_ID');
    expect(() => sessionSetFactId('invalid/path')).toThrow('INVALID_CLOUD_SESSION_SET_ID');
  });
});

describe('Dexie Cloud schema and access policy', () => {
  it('uses globally unique string IDs and explicit realm partition indexes', () => {
    expect(CLOUD_DATABASE_STORES_V1.trainingPlans).toContain('@id');
    expect(CLOUD_DATABASE_STORES_V1.trainingPlans).toContain('realmId');
    expect(CLOUD_DATABASE_STORES_V1.workoutSessions).toContain('@id');
    expect(CLOUD_DATABASE_STORES_V1.workoutSessions).toContain('realmId');
    expect(CLOUD_DATABASE_STORES_V1.sessionSets).toContain('@id');
    expect(CLOUD_DATABASE_STORES_V1.sessionSets).toContain('realmId');
    expect(CLOUD_DATABASE_STORES_V1.sessionSets).toContain('workoutSessionId');
    expect(CLOUD_DATABASE_STORES_V1.sessionSets).toContain('[sessionExerciseId+position]');
    expect(CLOUD_DATABASE_STORES_V1.sessionSetFacts).toMatch(/^id,/);
    expect(CLOUD_DATABASE_STORES_V1.sessionSetFacts).not.toContain('@id');
    expect(CLOUD_DATABASE_STORES_V1.sessionSetFacts).toContain('sessionSetId');
    expect(CLOUD_DATABASE_STORES_V1.sessionSetFacts).toContain('realmId');
    expect(CLOUD_DATABASE_STORES_V1.sessionSetFacts).toContain('workoutSessionId');
    expect(CLOUD_DATABASE_STORES_V1.sessionSetFactAudits).toContain('@id');
    expect(CLOUD_DATABASE_STORES_V1.sessionSetFactAudits).toContain('realmId');
    expect(CLOUD_DATABASE_STORES_V1.sessionSetFactAudits).toContain('sessionSetFactId');
    expect(CLOUD_DATABASE_STORES_V1.sessionSetFactAudits).toContain('sessionSetId');
    expect(CLOUD_DATABASE_STORES_V1.sessionSetFactAudits).toContain('confirmedAt');
    expect(CLOUD_DATABASE_STORES_V1.realms).toBe('@realmId');
    expect(CLOUD_DATABASE_STORES_V1.members).toContain('@id');
    expect(CLOUD_DATABASE_STORES_V1.roles).toBe('[realmId+name]');
  });

  const factFields: Array<keyof CloudSessionSetFactRow> = [
    'actualReps',
    'actualWeightKg',
    'actualDurationSeconds',
    'actualDistanceMeters',
    'setLabel',
    'rpe',
    'comment',
    'bands',
    'setStatus',
  ];

  it('allows PLAN authoring only by coach; neither role manages the session lifecycle', () => {
    expect(cloudRoles.roles.coach.permissions.manage).toEqual(['trainingPlans']);
    expect(JSON.stringify(cloudRoles.roles.coach.permissions)).not.toContain('sessionSetFactAudits');
    expect(JSON.stringify(cloudRoles.roles.client.permissions)).not.toContain('sessionSetFactAudits');
    expect(Object.hasOwn(cloudRoles.roles.client.permissions, 'manage')).toBe(false);
    expect(Object.hasOwn(cloudRoles.roles.coach.permissions, 'add')).toBe(false);
    expect(Object.hasOwn(cloudRoles.roles.client.permissions, 'add')).toBe(false);
  });

  it('grants both participants only field-scoped updates to existing set FACT records', () => {
    const coach = cloudRoles.roles.coach.permissions;
    const client = cloudRoles.roles.client.permissions;
    expect(coach.update).toEqual({ sessionSetFacts: factFields });
    expect(client.update).toEqual({ sessionSetFacts: factFields });
    expect(coach.update.sessionSetFacts).not.toContain('*');
    expect(Object.keys(coach.update)).toEqual(['sessionSetFacts']);
    expect(Object.keys(client.update)).toEqual(['sessionSetFacts']);
    expect(client.update.sessionSetFacts).not.toContain('*');
  });

  it('never allows clients or coaches to modify reserved IDs, workout associations, PLAN snapshots or lifecycle fields', () => {
    const protectedFields = [
      'id',
      'realmId',
      'owner',
      'workoutSessionId',
      'sessionExerciseId',
      'sourceProgramSetId',
      'coachUserId',
      'clientUserId',
      'trainingPlanId',
      'plannedReps',
      'plannedWeightKg',
      'plannedDurationSeconds',
      'plannedDistanceMeters',
      'position',
      'status',
      'startedAt',
      'completedAt',
      'actorUserId',
      'confirmedAt',
      'changedFields',
    ];
    for (const permissions of [cloudRoles.roles.coach.permissions, cloudRoles.roles.client.permissions]) {
      const editable = permissions.update.sessionSetFacts;
      for (const field of protectedFields) {
        expect(editable).not.toContain(field);
      }
      expect(Object.keys(permissions.update)).toEqual(['sessionSetFacts']);
      expect(JSON.stringify(permissions)).not.toContain('"workoutSessions"');
      expect(JSON.stringify(permissions)).not.toContain('"sessionSets"');
      expect(JSON.stringify(permissions)).not.toContain('"realms"');
      expect(JSON.stringify(permissions)).not.toContain('"members"');
      expect(JSON.stringify(permissions)).not.toContain('"roles"');
    }
  });
});
