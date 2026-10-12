import { describe, expect, it } from 'vitest';
import { relationshipMembership } from './dexie-cloud-membership';

describe('Dexie Cloud relationship member display names', () => {
  it('stores verified person names in their own membership without changing canonical IDs', async () => {
    const unnamed = await relationshipMembership('101', '202');
    const named = await relationshipMembership('101', '202', {
      coach: '  Тренер Иванов  ',
      client: '  Клиент Петров  ',
    });

    expect(named.realm).toEqual(unnamed.realm);
    expect(named.members.map(({ id, userId, realmId, roles }) => ({ id, userId, realmId, roles })))
      .toEqual(unnamed.members.map(({ id, userId, realmId, roles }) => ({ id, userId, realmId, roles })));
    expect(named.members.map((member) => member.name)).toEqual(['Тренер Иванов', 'Клиент Петров']);
    expect(named.members.every((member) => member.owner === null && member.accepted === true
      && member.invite === false)).toBe(true);
  });

  it('omits empty labels and limits overly long names without writing profile data elsewhere', async () => {
    const named = await relationshipMembership('101', '202', {
      coach: '   ',
      client: 'X'.repeat(200),
    });
    expect(named.members[0]).not.toHaveProperty('name');
    expect(named.members[1].name).toHaveLength(120);
  });
});
