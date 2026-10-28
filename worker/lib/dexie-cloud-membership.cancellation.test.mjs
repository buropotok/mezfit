import { describe, expect, it } from 'vitest';
import { EXPECTED_PLANNED_ROLES } from '../../tools/dexie-roles/planned-sessions.mjs';
import { EXPECTED_CANCELLATION_ROLES } from '../../tools/dexie-roles/calendar-cancellation.mjs';
import { assertRemoteRoles } from './dexie-cloud-membership';
const profile = (roles = EXPECTED_CANCELLATION_ROLES) => Object.entries(roles).map(([name, role]) => ({
  ...structuredClone(role), name, realmId: 'rlm-public',
}));
describe('membership preflight for logical deletion', () => {
  it('accepts complete previous and new profiles without a physical-delete grant', () => {
    expect(() => assertRemoteRoles(profile(EXPECTED_PLANNED_ROLES))).not.toThrow();
    expect(() => assertRemoteRoles(profile())).not.toThrow();
    for (const role of profile()) expect(role.permissions).not.toHaveProperty('delete');
  });
  it.each(['coach', 'client'])('rejects a partially installed inactive grant missing %s', name => {
    const roles = profile();
    const role = roles.find(role => role.name === name);
    if (!role) throw new Error('Missing fixture');
    role.permissions.update.workoutOccurrences.pop();
    expect(() => assertRemoteRoles(roles)).toThrow('CLOUD_MEMBERSHIP_UNAVAILABLE');
  });
  it('rejects broad deletion and identity updates in an otherwise valid profile', () => {
    for (const extra of ['owner', 'realmId', 'athleteUserId']) {
      const roles = profile(); roles[0].permissions.update.workoutOccurrences.push(extra);
      expect(() => assertRemoteRoles(roles)).toThrow('CLOUD_MEMBERSHIP_UNAVAILABLE');
    }
    const roles = profile(); Object.assign(roles[0].permissions, { delete: ['workoutOccurrences'] });
    expect(() => assertRemoteRoles(roles)).toThrow('CLOUD_MEMBERSHIP_UNAVAILABLE');
  });
});
