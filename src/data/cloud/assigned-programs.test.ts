import { beforeEach, describe, expect, it, vi } from 'vitest';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import { createCloudDatabase } from './database';
import { AssignedProgramsRepository, isApprovedAssignedPair, sortAssignedPlans } from './assigned-programs';

vi.mock('./database', () => ({ createCloudDatabase: vi.fn() }));
const createCloudDatabaseMock = vi.mocked(createCloudDatabase);

async function fixture() {
  // Use the Worker contract, not a made-up realm/member ID in these tests.
  const expected = await relationshipMembership('101', '202');
  const realm = { ...expected.realm, owner: null as string | null };
  const members = expected.members.map((member) => ({
    ...member,
    accepted: new Date('2026-10-12T00:00:00Z'),
    roles: [...member.roles] as string[],
    owner: null as string | null,
    invite: false as boolean,
    permissions: undefined as Record<string, unknown> | undefined,
  }));
  const rows: Array<Record<string, unknown>> = [];
  const add = vi.fn(async (record: Record<string, unknown>) => {
    rows.push(record);
    return 'tra-new';
  });
  const close = vi.fn();
  const sync = vi.fn(async () => undefined);
  const db = {
    members: {
      where: (index: string) => ({
        equals: (value: string) => ({
          toArray: async () => members.filter((member) =>
            index === 'realmId' ? member.realmId === value : member.userId === value),
        }),
      }),
      toArray: async () => members,
    },
    realms: {
      get: vi.fn(async (id: string) => id === realm.realmId ? realm : undefined),
      toArray: async () => [realm],
    },
    trainingPlans: {
      where: () => ({ equals: () => ({ count: async () => rows.length }) }),
      add,
      toArray: async () => rows,
    },
    cloud: { sync },
    close,
  };
  createCloudDatabaseMock.mockReturnValue(db as unknown as ReturnType<typeof createCloudDatabase>);
  return { db, realm, members, expected, rows, add, close, sync };
}

beforeEach(() => createCloudDatabaseMock.mockReset());

describe('assigned PLAN ordering', () => {
  it('sorts by persisted position and stable cloud ID without mutating local rows', () => {
    const plans = [
      { id: 'tra-z', position: 2 }, { id: 'tra-b', position: 0 },
      { id: 'tra-a', position: 0 }, { id: 'tra-c', position: 1 },
    ];
    expect(sortAssignedPlans(plans).map((plan) => plan.id))
      .toEqual(['tra-a', 'tra-b', 'tra-c', 'tra-z']);
    expect(plans.map((plan) => plan.id)).toEqual(['tra-z', 'tra-b', 'tra-a', 'tra-c']);
  });
});

describe('canonical shared relationship PLAN access', () => {
  it('accepts only the exact Worker-provisioned ownerless realm and its two accepted members', async () => {
    const f = await fixture();
    expect(await isApprovedAssignedPair(f.realm, f.members, 'tg:101', 'tg:202')).toBe(true);
    expect(await isApprovedAssignedPair(
      { ...f.realm, realmId: 'rlm-noncanonical' }, f.members, 'tg:101', 'tg:202',
    )).toBe(false);
    expect(await isApprovedAssignedPair(
      { ...f.realm, owner: 'tg:101' }, f.members, 'tg:101', 'tg:202',
    )).toBe(false);
    expect(await isApprovedAssignedPair(
      f.realm, f.members, 'tg:202', 'tg:101',
    )).toBe(false);
  });

  it('rejects extra, owned, invited, unaccepted, privileged or incorrectly-role-assigned members', async () => {
    const f = await fixture();
    const approved = () => isApprovedAssignedPair(f.realm, f.members, 'tg:101', 'tg:202');
    f.members.push({ ...f.members[1], id: 'mmb-intruder', userId: 'tg:303' });
    expect(await approved()).toBe(false);
    f.members.pop();
    f.members[1].owner = 'tg:202';
    expect(await approved()).toBe(false);
    f.members[1].owner = null;
    f.members[1].invite = true;
    expect(await approved()).toBe(false);
    f.members[1].invite = false;
    f.members[1].accepted = new Date(NaN);
    expect(await approved()).toBe(false);
    f.members[1].accepted = new Date('2026-10-12T00:00:00Z');
    f.members[1].permissions = { manage: ['trainingPlans'] };
    expect(await approved()).toBe(false);
    f.members[1].permissions = undefined;
    f.members[1].roles = ['client', 'coach'];
    expect(await approved()).toBe(false);
    f.members[1].roles = ['client'];
    f.members[1].id = 'mmb-forged';
    expect(await approved()).toBe(false);
    f.members[1].id = f.expected.members[1].id;
    expect(await approved()).toBe(true);
  });
});

describe('assigned Dexie Cloud PLAN repository', () => {
  it('creates an ownerless draft only in the Worker-provisioned pair realm', async () => {
    const f = await fixture();
    const repository = new AssignedProgramsRepository('101', 'signed');
    const id = await repository.createAssigned('202', '  Тестовая программа  ');
    expect(id).toBe('tra-new');
    expect(createCloudDatabaseMock).toHaveBeenCalledWith('101', 'signed');
    expect(f.db.realms.get).toHaveBeenCalledWith(f.expected.realm.realmId);
    expect(f.add).toHaveBeenCalledWith(expect.objectContaining({
      realmId: f.expected.realm.realmId, owner: null,
      coachUserId: 'tg:101', clientUserId: 'tg:202',
      name: 'Тестовая программа', status: 'draft',
    }));
    await repository.refresh();
    expect(f.sync).toHaveBeenCalledWith({ purpose: 'pull', wait: true });
    repository.close();
    expect(f.close).toHaveBeenCalledTimes(1);
  });

  it('refuses unlinked clients, wrong owners and malformed/self identities', async () => {
    const f = await fixture();
    const repository = new AssignedProgramsRepository('101', 'signed');
    await expect(repository.createAssigned('303', 'Чужая программа')).rejects.toThrow('Связь');
    await expect(repository.createAssigned('101', 'Своя программа')).rejects.toThrow('самому себе');
    await expect(repository.createAssigned('abc', 'Некорректно')).rejects.toThrow('Некорректный клиент');
    f.realm.owner = 'tg:101';
    await expect(repository.createAssigned('202', 'Чужой realm')).rejects.toThrow('Связь');
    expect(f.add).not.toHaveBeenCalled();
  });
});
