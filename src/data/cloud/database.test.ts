import { describe, expect, it } from 'vitest';
import cloudRoles from '../../../cloud/roles.json';
import {
  CLOUD_DATABASE_STORES_V1,
  cloudDatabaseName,
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

describe('Dexie Cloud schema and access policy', () => {
  it('uses globally unique string IDs and explicit realm partition indexes', () => {
    expect(CLOUD_DATABASE_STORES_V1.trainingPlans).toContain('@id');
    expect(CLOUD_DATABASE_STORES_V1.trainingPlans).toContain('realmId');
    expect(CLOUD_DATABASE_STORES_V1.workoutSessions).toContain('@id');
    expect(CLOUD_DATABASE_STORES_V1.workoutSessions).toContain('realmId');
    expect(CLOUD_DATABASE_STORES_V1.realms).toBe('@realmId');
    expect(CLOUD_DATABASE_STORES_V1.members).toContain('@id');
    expect(CLOUD_DATABASE_STORES_V1.roles).toBe('[realmId+name]');
  });

  it('permits coach PLAN mutations and shared FACT mutations, but denies client PLAN mutations', () => {
    const coach = cloudRoles.roles.coach.permissions.manage;
    const client = cloudRoles.roles.client.permissions.manage;
    expect(coach).toContain('trainingPlans');
    expect(coach).toContain('workoutSessions');
    expect(client).toContain('workoutSessions');
    expect(client).not.toContain('trainingPlans');
  });

  it('does not grant realm or membership management through product roles', () => {
    for (const role of [cloudRoles.roles.coach, cloudRoles.roles.client]) {
      expect(role.permissions.manage).not.toContain('members');
      expect(role.permissions.manage).not.toContain('realms');
      expect(role.permissions.manage).not.toContain('*');
    }
  });
});
