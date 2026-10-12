import { describe, expect, it } from 'vitest';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import { deriveCloudContacts } from './CloudConnectionsProvider';

async function link(coach: string, client: string, coachName = 'Тренер', clientName = 'Клиент') {
  const { realm, members } = await relationshipMembership(coach, client, { coach: coachName, client: clientName });
  return {
    realm,
    members: members.map((member) => ({
      ...member,
      roles: [...member.roles],
      accepted: new Date('2026-10-12T00:00:00Z'),
    })),
  };
}

describe('Dexie Cloud coach-client directory', () => {
  it('shows all linked clients to a coach, but only own coaches to each client', async () => {
    const first = await link('101', '202', 'Анна', 'Борис');
    const second = await link('101', '303', 'Анна', 'Вера');
    const realms = [first.realm, second.realm];
    const members = [...first.members, ...second.members];

    const coach = await deriveCloudContacts('tg:101', realms, members);
    expect(coach.coaches).toEqual([]);
    expect(coach.clients.map((item) => [item.relationshipId, item.userId, item.displayName]))
      .toEqual([
        [first.realm.realmId, 'tg:202', 'Борис'],
        [second.realm.realmId, 'tg:303', 'Вера'],
      ]);

    const client = await deriveCloudContacts('tg:202', realms, members);
    expect(client.clients).toEqual([]);
    expect(client.coaches.map((item) => item.userId)).toEqual(['tg:101']);
    expect((await deriveCloudContacts('tg:404', realms, members))).toEqual({ clients: [], coaches: [] });
  });

  it('rejects unrelated realms, extra, unaccepted and owned members', async () => {
    const pair = await link('101', '202');
    expect((await deriveCloudContacts('tg:101', [{ ...pair.realm, owner: 'tg:101' }], pair.members)).clients).toEqual([]);
    expect((await deriveCloudContacts('tg:101', [{ ...pair.realm, realmId: 'rlm-stray' }], pair.members)).clients).toEqual([]);
    expect((await deriveCloudContacts('tg:101', [pair.realm], [
      ...pair.members, { ...pair.members[1], id: 'mmb-extra', userId: 'tg:303' },
    ])).clients).toEqual([]);

    const invalid = pair.members.map((member) => ({ ...member }));
    invalid[1].accepted = new Date(NaN);
    expect((await deriveCloudContacts('tg:101', [pair.realm], invalid)).clients).toEqual([]);
  });

  it('shows an honest fallback name but never exposes numeric D1 user IDs', async () => {
    const pair = await link('101', '202');
    delete pair.members[1].name;
    const { clients } = await deriveCloudContacts('tg:101', [pair.realm], pair.members);
    expect(clients[0]).toMatchObject({
      id: 'tg:202', telegramUserId: '202', firstName: 'Клиент Mezfit',
    });
    expect(clients[0].relationshipId).toBe(pair.realm.realmId);
  });
});
