import { describe, expect, it } from 'vitest';
import calendar from '../../cloud/roles.json';
import overlay from '../../cloud/adhoc-session-roles.json';
import { assertRemoteRoles } from './dexie-cloud-membership';

function profile(expanded: boolean) {
  return Object.entries(calendar.roles).map(([name, role]) => ({
    ...structuredClone(role), name, realmId: 'rlm-public',
    permissions: {
      ...structuredClone(role.permissions),
      add: [...role.permissions.add, ...(expanded && name === 'coach' ? overlay.roles.coach.permissions.add : [])],
      update: { ...structuredClone(role.permissions.update),
        ...(expanded && name === 'coach' ? structuredClone(overlay.roles.coach.permissions.update) : {}) },
    },
  }));
}

describe('membership preflight during scoped ad-hoc activation', () => {
  it('accepts the exact calendar and expanded permissions without changing Client', () => {
    expect(() => assertRemoteRoles(profile(false))).not.toThrow();
    expect(() => assertRemoteRoles(profile(true))).not.toThrow();
    expect(profile(true)[1]).toEqual(profile(false)[1]);
  });
  it('rejects partial installs, extra fields and planned lifecycle grants', () => {
    const partial = profile(true);
    partial[0].permissions.add.pop();
    expect(() => assertRemoteRoles(partial)).toThrow('CLOUD_MEMBERSHIP_UNAVAILABLE');
    const broadened = profile(true);
    Reflect.set(broadened[0].permissions.update, 'workoutSessions', ['status']);
    expect(() => assertRemoteRoles(broadened)).toThrow('CLOUD_MEMBERSHIP_UNAVAILABLE');
    const moved = profile(true);
    const updates = moved[0].permissions.update;
    const fields = Reflect.get(updates, 'adHocSets');
    if (!Array.isArray(fields)) throw new Error('Invalid fixture');
    fields.push('realmId');
    expect(() => assertRemoteRoles(moved)).toThrow('CLOUD_MEMBERSHIP_UNAVAILABLE');
  });
  it('rejects ad-hoc grants added to Client', () => {
    const roles = profile(true);
    roles[1].permissions.add.push('adHocSessions');
    expect(() => assertRemoteRoles(roles)).toThrow('CLOUD_MEMBERSHIP_UNAVAILABLE');
  });
});
