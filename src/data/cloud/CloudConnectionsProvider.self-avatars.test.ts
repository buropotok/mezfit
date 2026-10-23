import { describe, expect, it } from 'vitest';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import { stableCloudRelationshipId } from '../../../shared/relationship-id';
import { deriveCloudContacts, deriveCloudSelfAvatars } from './CloudConnectionsProvider';

async function approved() {
  const { realm, members } = await relationshipMembership('101', '202');
  const authorized = members.map(member => ({
    ...member,
    roles: [...member.roles],
    accepted: new Date('2026-10-12T00:00:00Z'),
  }));
  const contacts = await deriveCloudContacts('tg:101', [realm], authorized);
  return { realm, contacts };
}

describe('own avatar from authorized cloud contactProfiles', () => {
  it('projects the own photo for a validated relationship without changing peer identities', async () => {
    const { realm, contacts } = await approved();
    const version = 'a'.repeat(64);
    const profile = {
      id: await stableCloudRelationshipId('prf', realm.realmId + ':tg:101'),
      realmId: realm.realmId, userId: 'tg:101', owner: null, name: 'Coach',
      avatarVersion: version,
      avatarSmall: new Blob([new Uint8Array(120)], { type: 'image/jpeg' }),
      avatarLarge: { _bt: 'Blob', ref: '1:abc123def456', size: 2000, ct: 'image/jpeg' },
    };
    const own = await deriveCloudSelfAvatars('tg:101', contacts.clients, [profile]);
    expect(own).toEqual([{
      relationshipId: realm.realmId, userId: 'tg:101', telegramUserId: '101',
      displayName: 'Coach', avatarVersion: version, avatarMode: '1r0',
    }]);
    expect(contacts.clients).toHaveLength(1);
    expect(contacts.clients[0].userId).toBe('tg:202');
  });

  it('never exposes an own-looking profile from an unauthorized or mismatched realm', async () => {
    const { realm, contacts } = await approved();
    const profile = {
      id: await stableCloudRelationshipId('prf', realm.realmId + ':tg:101'),
      realmId: realm.realmId, userId: 'tg:101', owner: null, name: 'Coach',
      avatarVersion: 'b'.repeat(64),
      avatarSmall: new Blob([new Uint8Array(120)], { type: 'image/jpeg' }),
    };
    expect(await deriveCloudSelfAvatars('tg:101', [], [profile])).toEqual([]);
    expect(await deriveCloudSelfAvatars('tg:303', contacts.clients, [profile])).toEqual([]);
    for (const invalid of [
      { ...profile, owner: 'tg:101' },
      { ...profile, id: 'prf-invalid' },
      { ...profile, realmId: 'rlm' + 'c'.repeat(28) },
      { ...profile, userId: 'tg:303' },
    ]) {
      expect(await deriveCloudSelfAvatars('tg:101', contacts.clients, [invalid])).toEqual([]);
    }
  });

  it('does not advertise a cloud image if only a legacy version string exists', async () => {
    const { realm, contacts } = await approved();
    const own = await deriveCloudSelfAvatars('tg:101', contacts.clients, [{
      id: await stableCloudRelationshipId('prf', realm.realmId + ':tg:101'),
      realmId: realm.realmId, userId: 'tg:101', owner: null, name: 'Coach',
      avatarVersion: 'c'.repeat(64),
    }]);
    expect(own[0].avatarVersion).toBeNull();
  });
});
