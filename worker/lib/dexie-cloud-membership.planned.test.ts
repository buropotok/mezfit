import { describe, expect, it } from 'vitest';
import calendar from '../../cloud/roles.json';
import adHoc from '../../cloud/adhoc-session-roles.json';
import planned from '../../cloud/planned-session-roles.json';
import { assertRemoteRoles } from './dexie-cloud-membership';

function profile(stage: 'calendar' | 'adhoc' | 'planned') {
  return Object.entries(calendar.roles).map(([name, role]) => {
    const expanded = name === 'coach' && stage !== 'calendar';
    return { ...structuredClone(role), name, realmId: 'rlm-public', permissions: {
      ...structuredClone(role.permissions),
      add: [...role.permissions.add, ...(expanded ? adHoc.roles.coach.permissions.add : [])],
      update: { ...structuredClone(role.permissions.update),
        ...(expanded ? structuredClone(adHoc.roles.coach.permissions.update) : {}),
        ...(name === 'coach' && stage === 'planned' ? { workoutOccurrences: [
          ...calendar.roles.coach.permissions.update.workoutOccurrences,
          ...planned.roles.coach.permissions.update.workoutOccurrences,
        ] } : {}),
      },
    } };
  });
}

describe('membership preflight during approved Coach planned-session rollout', () => {
  it('accepts each complete reviewed profile and preserves Client permissions', () => {
    for (const stage of ['calendar', 'adhoc', 'planned'] as const)
      expect(() => assertRemoteRoles(profile(stage))).not.toThrow();
    expect(profile('planned')[1]).toEqual(profile('calendar')[1]);
  });
  it.each(['status', 'workoutSessionId'])('rejects a partial planned profile missing %s', field => {
    const roles = profile('planned');
    const fields = roles[0].permissions.update.workoutOccurrences;
    fields.splice(fields.indexOf(field), 1);
    expect(() => assertRemoteRoles(roles)).toThrow('CLOUD_MEMBERSHIP_UNAVAILABLE');
  });
  it('rejects lifecycle grants without the complete execution grant baseline', () => {
    const roles = profile('planned');
    roles[0].permissions.add.pop();
    expect(() => assertRemoteRoles(roles)).toThrow('CLOUD_MEMBERSHIP_UNAVAILABLE');
  });
  it('rejects a Client lifecycle grant, foreign-link updates and unrelated Coach grant drift', () => {
    const client = profile('planned');
    client[1].permissions.update.workoutOccurrences.push('status', 'workoutSessionId');
    expect(() => assertRemoteRoles(client)).toThrow('CLOUD_MEMBERSHIP_UNAVAILABLE');
    const link = profile('planned');
    link[0].permissions.update.workoutOccurrences.push('realmId');
    expect(() => assertRemoteRoles(link)).toThrow('CLOUD_MEMBERSHIP_UNAVAILABLE');
    const source = profile('planned');
    source[0].permissions.add.push('programSets');
    expect(() => assertRemoteRoles(source)).toThrow('CLOUD_MEMBERSHIP_UNAVAILABLE');
  });
});
