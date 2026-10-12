import { describe, expect, it } from 'vitest';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import { stableCloudRelationshipId } from '../../../shared/relationship-id';
import { deriveCloudContacts } from './CloudConnectionsProvider';

describe('relationship-scoped contact profile projection', () => {
  it('shows an updated signed name and immutable avatar version without changing membership roles', async () => {
    const { realm, members } = await relationshipMembership('101', '202');
    const photoVersion = 'a'.repeat(64);
    const profile = {
      id: await stableCloudRelationshipId('prf', realm.realmId + ':tg:202'),
      realmId: realm.realmId,
      owner: null,
      userId: 'tg:202',
      name: 'Новое имя клиента',
      avatarVersion: photoVersion,
    };
    const coach = await deriveCloudContacts('tg:101', [realm], members, [profile]);
    expect(coach.clients[0]).toMatchObject({
      userId: 'tg:202',
      displayName: 'Новое имя клиента',
      avatarVersion: photoVersion,
    });
    const client = await deriveCloudContacts('tg:202', [realm], members, [profile]);
    expect(client.coaches[0].displayName).toBe('Тренер Mezfit');
    expect(members.map((member) => member.roles)).toEqual([['coach'], ['client']]);
  });

  it('rejects forged, owned and unrelated profile rows without losing approved relationships', async () => {
    const { realm, members } = await relationshipMembership('101', '202');
    const canonical = {
      id: await stableCloudRelationshipId('prf', realm.realmId + ':tg:202'),
      realmId: realm.realmId, userId: 'tg:202', owner: null,
      name: 'Анна', avatarVersion: 'b'.repeat(64),
    };
    for (const forged of [
      { ...canonical, id: 'prfforged' },
      { ...canonical, owner: 'tg:101' },
      { ...canonical, realmId: 'rlmoutsider' },
      { ...canonical, userId: 'tg:404' },
    ]) {
      const derived = await deriveCloudContacts('tg:101', [realm], members, [forged]);
      expect(derived.clients[0].displayName).toBe('Клиент Mezfit');
      expect(derived.clients[0].avatarVersion).toBeNull();
    }
  });
});
