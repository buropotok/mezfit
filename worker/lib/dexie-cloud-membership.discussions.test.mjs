import { describe, expect, it } from 'vitest';
import { EXPECTED_FLEX_ROLES } from '../../tools/dexie-roles/flex-attributes.mjs';
import { EXPECTED_DISCUSSION_ROLES, LEGACY_DISCUSSION_ROLES } from '../../tools/dexie-roles/discussions.mjs';
import { assertRemoteRoles, relationshipMembership } from './dexie-cloud-membership';
import { checkApprovedAssignedPair } from '../../shared/approved-relationship';
import { DISCUSSION_ROLE_OVERLAY } from '../../tools/dexie-roles/discussions.mjs';
const profile = source => Object.entries(source).map(([name, row]) => ({ ...structuredClone(row), name, realmId: 'rlm-public' }));

describe('native ownership profile and existing pair visibility', () => {
  it('accepts exactly the old and new profiles without common update/manage grants on other authors messages/read states', () => {
    expect(() => assertRemoteRoles(profile(EXPECTED_FLEX_ROLES))).not.toThrow();
    expect(() => assertRemoteRoles(profile(EXPECTED_DISCUSSION_ROLES))).not.toThrow();
    expect(() => assertRemoteRoles(profile(LEGACY_DISCUSSION_ROLES))).not.toThrow();
    for (const grant of Object.values(DISCUSSION_ROLE_OVERLAY.roles)) {
      expect(grant.permissions.update).toEqual({ discussionThreads: ['lastActivityAt'] });
      expect(grant.permissions).not.toHaveProperty('manage');
      expect(grant.permissions.add).toEqual(['discussionThreads', 'discussionMessages', 'discussionReadStates', 'messageAttachments']);
    }
  });
  it('rejects partial/duplicate/escalated communication grants and unrelated identity/FACT changes', () => {
    for (const mutate of [
      rows => rows[0].permissions.add.pop(),
      rows => rows[1].permissions.add.push('discussionMessages'),
      rows => { rows[0].permissions.update.discussionMessages = ['text']; },
      rows => { rows[1].permissions.update.discussionReadStates = ['lastReadAt']; },
      rows => rows[0].permissions.update.discussionThreads.push('anchor'),
      rows => rows[1].permissions.add.push('messageAttachments'),
      rows => { rows[1].permissions.update.messageAttachments = ['uploadState']; },
      rows => { rows[0].permissions.manage = ['messageAttachments']; },
      rows => rows[1].permissions.update.sessionSetFacts.push('owner'),
    ]) { const rows = profile(EXPECTED_DISCUSSION_ROLES); mutate(rows); expect(() => assertRemoteRoles(rows)).toThrow(); }
  });
  it('rejects a mixed text-only/MVP profile without disturbing the complete installed text profile', () => {
    const mixed = profile(EXPECTED_DISCUSSION_ROLES);
    mixed[1] = profile(LEGACY_DISCUSSION_ROLES)[1];
    expect(() => assertRemoteRoles(mixed)).toThrow();
    const altered = profile(LEGACY_DISCUSSION_ROLES);
    altered[0].permissions.update.sessionSetFacts.push('owner');
    expect(() => assertRemoteRoles(altered)).toThrow();
  });
  it('retains the former pairs membership visibility and never confuses a different coach or removed member', async () => {
    const first = await relationshipMembership('11', '22');
    const second = await relationshipMembership('33', '22');
    const formerRealm = { ...first.realm, endedAt: '2026-11-06T12:00:00.000Z' };
    const check = (realm, members, coachUserId = 'tg:11') => checkApprovedAssignedPair({ realm, members, coachUserId, clientUserId: 'tg:22' });
    expect(await check(formerRealm, first.members)).toBe(true);
    expect(await check(formerRealm, first.members, 'tg:33')).toBe(false);
    expect(await check(second.realm, second.members, 'tg:33')).toBe(true);
    expect(await check(formerRealm, first.members.slice(0, 1))).toBe(false);
    expect(await check(formerRealm, [...first.members, second.members[0]])).toBe(true);
    expect(await check(formerRealm, [...first.members, { ...second.members[0], realmId: first.realm.realmId }])).toBe(false);
  });
});
