import { describe, expect, it } from 'vitest';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import { isApprovedAssignedPair } from './assigned-programs';
import { deriveCloudContacts } from './CloudConnectionsProvider';

describe('Dexie Cloud Worker acceptance contract', () => {
  it('renders the actual Worker-provisioned accepted:true pair for both Telegram roles', async () => {
    // The privileged REST write and cloud export retain accepted:true.
    const { realm, members } = await relationshipMembership('101', '202', {
      coach: 'Тренер', client: 'Клиент',
    });
    expect(members.map((member) => member.accepted)).toEqual([true, true]);
    expect(await isApprovedAssignedPair(realm, members, 'tg:101', 'tg:202')).toBe(true);

    const coach = await deriveCloudContacts('tg:101', [realm], members);
    const client = await deriveCloudContacts('tg:202', [realm], members);
    expect(coach.clients.map(({ userId, displayName }) => [userId, displayName]))
      .toEqual([['tg:202', 'Клиент']]);
    expect(client.coaches.map(({ userId, displayName }) => [userId, displayName]))
      .toEqual([['tg:101', 'Тренер']]);
  });

  it('continues to accept an explicit valid Date for SDK-created accepted memberships', async () => {
    const { realm, members } = await relationshipMembership('101', '202');
    const dated = members.map((member) => ({ ...member, accepted: new Date('2026-10-12T00:00:00Z') }));
    expect(await isApprovedAssignedPair(realm, dated, 'tg:101', 'tg:202')).toBe(true);
  });

  it('rejects a missing, false, malformed or invalid acceptance flag', async () => {
    const { realm, members } = await relationshipMembership('101', '202');
    const invalid: unknown[] = [false, undefined, null, 'true', '2026-10-12', 1, new Date(NaN)];
    for (const accepted of invalid) {
      const forged = [
        members[0],
        { ...members[1], accepted: accepted as Date | boolean | undefined },
      ];
      expect(await isApprovedAssignedPair(realm, forged, 'tg:101', 'tg:202')).toBe(false);
    }
  });

  it('does not weaken realm identity, role, ownership, or exact member-count validation', async () => {
    const { realm, members } = await relationshipMembership('101', '202');
    expect(await isApprovedAssignedPair(
      { ...realm, owner: 'tg:101' }, members, 'tg:101', 'tg:202',
    )).toBe(false);
    expect(await isApprovedAssignedPair(
      realm, [{ ...members[0], owner: 'tg:101' }, members[1]], 'tg:101', 'tg:202',
    )).toBe(false);
    expect(await isApprovedAssignedPair(
      realm, [{ ...members[0], roles: ['client'] }, members[1]], 'tg:101', 'tg:202',
    )).toBe(false);
    expect(await isApprovedAssignedPair(
      realm, [...members, { ...members[1], id: 'mmbextra' }], 'tg:101', 'tg:202',
    )).toBe(false);
    expect(await isApprovedAssignedPair(realm, members, 'tg:999', 'tg:202')).toBe(false);
  });
});
