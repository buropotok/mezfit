import { describe, expect, it } from 'vitest';
import { EXPECTED_CLIENT_SESSION_ROLES } from '../../tools/dexie-roles/client-sessions.mjs';
import { EXPECTED_FLEX_ROLES } from '../../tools/dexie-roles/flex-attributes.mjs';
import { assertRemoteRoles } from './dexie-cloud-membership';

const profile = (source = EXPECTED_FLEX_ROLES) =>
  Object.entries(source).map(([name, role]) => ({ ...structuredClone(role), name, realmId: 'rlm-public' }));

describe('membership preflight for Flex Attributes ACL rollout', () => {
  it('accepts both the previous complete Client execution policy and complete Flex extension', () => {
    expect(() => assertRemoteRoles(profile(EXPECTED_CLIENT_SESSION_ROLES))).not.toThrow();
    expect(() => assertRemoteRoles(profile())).not.toThrow();
  });

  it('rejects partially installed Flex grants and any new authorization escalation', () => {
    for (const mutate of [
      roles => { roles[0].permissions.add.pop(); },
      roles => { roles[1].permissions.add.pop(); },
      roles => { roles[0].permissions.update.flexValues.push('owner'); },
      roles => { roles[1].permissions.update.flexValues = ['value', 'entityId']; },
      roles => { delete roles[0].permissions.update.flexValues; },
      roles => { delete roles[1].permissions.update.flexValues; },
      roles => { roles[0].permissions.update.flexAttributes = ['valueType']; },
      roles => { roles[1].permissions.manage = ['flexValues']; },
      roles => { roles[0].permissions.add.push('sessionSetFacts'); },
      roles => { roles[0].permissions.update.sessionSetFacts.push('owner'); },
    ]) {
      const roles = profile();
      mutate(roles);
      expect(() => assertRemoteRoles(roles)).toThrow('CLOUD_MEMBERSHIP_UNAVAILABLE');
    }
  });

  it('rejects a Flex extension installed for only one role', () => {
    for (const role of ['coach', 'client']) {
      const roles = profile();
      const candidate = roles.find(item => item.name === role);
      const original = EXPECTED_CLIENT_SESSION_ROLES[role];
      candidate.permissions = structuredClone(original.permissions);
      expect(() => assertRemoteRoles(roles)).toThrow('CLOUD_MEMBERSHIP_UNAVAILABLE');
    }
  });
});
