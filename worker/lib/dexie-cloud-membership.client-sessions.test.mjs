import { describe, expect, it } from 'vitest';
import { EXPECTED_CANCELLATION_ROLES } from '../../tools/dexie-roles/calendar-cancellation.mjs';
import { EXPECTED_CLIENT_SESSION_ROLES } from '../../tools/dexie-roles/client-sessions.mjs';
import { assertRemoteRoles } from './dexie-cloud-membership';
const profile = (roles = EXPECTED_CLIENT_SESSION_ROLES) => Object.entries(roles).map(([name, role]) => ({
  ...structuredClone(role), name, realmId: 'rlm-public',
}));
describe('membership preflight for Client workout execution', () => {
  it('accepts complete previous and new profiles', () => {
    expect(() => assertRemoteRoles(profile(EXPECTED_CANCELLATION_ROLES))).not.toThrow();
    expect(() => assertRemoteRoles(profile())).not.toThrow();
  });
  it.each(['status', 'workoutSessionId'])('rejects incomplete lifecycle missing %s', field => {
    const roles = profile();
    const client = roles.find(role => role.name === 'client');
    client.permissions.update.workoutOccurrences = client.permissions.update.workoutOccurrences.filter(item => item !== field);
    expect(() => assertRemoteRoles(roles)).toThrow('CLOUD_MEMBERSHIP_UNAVAILABLE');
  });
  it('rejects partial execution, broadened PLAN/identity grants and missing baseline', () => {
    for (const mutate of [
      r => { r[1].permissions.add.pop(); },
      r => { delete r[1].permissions.update.adHocSets; },
      r => { r[1].permissions.update.adHocSessions.push('occurrencePlan'); },
      r => { r[1].permissions.update.workoutOccurrences.push('plan'); },
      r => { r[1].permissions.manage = ['adHocSessions']; },
      r => { r[1].permissions.update.workoutOccurrences = r[1].permissions.update.workoutOccurrences.filter(f => f !== 'inactive'); },
    ]) {
      const roles = profile(); mutate(roles);
      expect(() => assertRemoteRoles(roles)).toThrow('CLOUD_MEMBERSHIP_UNAVAILABLE');
    }
  });
});
