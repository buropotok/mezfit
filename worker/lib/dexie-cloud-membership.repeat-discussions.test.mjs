import { describe, expect, it } from 'vitest';
import { EXPECTED_FLEX_ROLES } from '../../tools/dexie-roles/flex-attributes.mjs';
import { EXPECTED_DISCUSSION_ROLES, LEGACY_DISCUSSION_ROLES } from '../../tools/dexie-roles/discussions.mjs';
import { addRepeatPermission } from '../../tools/dexie-roles/calendar-repeat.mjs';
import { assertRemoteRoles } from './dexie-cloud-membership';
const rows = source => Object.entries(source).map(([name, role]) => ({ ...structuredClone(role), name, realmId: 'rlm-public' }));
describe('membership compatibility with protected discussion repeat profiles', () => {
  it.each([EXPECTED_FLEX_ROLES, LEGACY_DISCUSSION_ROLES, EXPECTED_DISCUSSION_ROLES])('accepts the exact preserved repeat overlay without mutating it', source => {
    const profile = rows(addRepeatPermission(source)), before = structuredClone(profile);
    expect(() => assertRemoteRoles(profile)).not.toThrow();
    expect(profile).toEqual(before);
  });
  it('rejects mixed, duplicated or expanded repeat profiles and unrelated permission drift', () => {
    for (const change of [
      profile => { profile[0].permissions.update.workoutOccurrences = profile[0].permissions.update.workoutOccurrences.filter(field => field !== 'pendingRepeatRule'); },
      profile => profile[1].permissions.update.workoutOccurrences.push('pendingRepeatRule'),
      profile => profile[0].permissions.update.workoutOccurrences.push('owner'),
      profile => profile[1].permissions.add.push('messageAttachments'),
      profile => profile[1].permissions.update.sessionSetFacts.push('owner'),
    ]) {
      const profile = rows(addRepeatPermission(EXPECTED_DISCUSSION_ROLES)); change(profile);
      expect(() => assertRemoteRoles(profile)).toThrow('CLOUD_MEMBERSHIP_UNAVAILABLE');
    }
  });
});
