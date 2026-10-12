import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCloudDatabase } from './database';
import { AssignedProgramsRepository, isApprovedAssignedPair } from './assigned-programs';

vi.mock('./database', () => ({ createCloudDatabase: vi.fn() }));

const createCloudDatabaseMock = vi.mocked(createCloudDatabase);

function fixture() {
  const records: Array<Record<string, unknown>> = [];
  const roles = [
    { userId: 'tg:101', realmId: 'rlm-valid', roles: ['coach'] },
    { userId: 'tg:202', realmId: 'rlm-valid', roles: ['client'] },
    { userId: 'tg:303', realmId: 'rlm-other', roles: ['client'] },
  ];
  const add = vi.fn(async (record: Record<string, unknown>) => {
    records.push(record);
    return 'tra-new';
  });
  const close = vi.fn();
  const refresh = vi.fn(async () => undefined);
  const db = {
    members: {
      where: () => ({
        equals: (userId: string) => ({
          toArray: async () => roles.filter((member) => member.userId === userId),
        }),
      }),
    },
    realms: {
      get: vi.fn(async (id: string): Promise<{ realmId: string; owner: string | null }> => ({ realmId: id, owner: null })),
    },
    trainingPlans: {
      where: () => ({ equals: () => ({ count: async () => records.length }) }),
      add,
    },
    cloud: { sync: refresh },
    close,
  };
  createCloudDatabaseMock.mockReturnValue(db as unknown as ReturnType<typeof createCloudDatabase>);
  return { db, add, roles, records, refresh, close };
}

beforeEach(() => {
  createCloudDatabaseMock.mockReset();
});

describe('assigned PLAN read scope', () => {
  const members = [
    { userId: 'tg:101', realmId: 'rlm-pair', roles: ['coach'] },
    { userId: 'tg:202', realmId: 'rlm-pair', roles: ['client'] },
  ];

  it('accepts only an ownerless shared realm with the exact coach/client role pair', () => {
    expect(isApprovedAssignedPair(null, members, 'rlm-pair', 'tg:101', 'tg:202')).toBe(true);
    expect(isApprovedAssignedPair('tg:202', members, 'rlm-pair', 'tg:101', 'tg:202')).toBe(false);
    expect(isApprovedAssignedPair(undefined, members, 'tg:202', 'tg:101', 'tg:202')).toBe(false);
    expect(isApprovedAssignedPair(null, members, 'rlm-pair', 'tg:101', 'tg:303')).toBe(false);
    expect(isApprovedAssignedPair(null, members, 'rlm-pair', 'tg:202', 'tg:101')).toBe(false);
    expect(isApprovedAssignedPair(null, members, 'rlm-pair', 'tg:101', 'tg:101')).toBe(false);
  });
});

describe('assigned Dexie Cloud PLAN repository', () => {
  it('creates an ownerless draft only in the pair realm using stable cloud identities', async () => {
    const f = fixture();
    const repository = new AssignedProgramsRepository('101', 'signed');
    const id = await repository.createAssigned('202', '  Тестовая программа  ');
    expect(id).toBe('tra-new');
    expect(createCloudDatabaseMock).toHaveBeenCalledWith('101', 'signed');
    expect(f.add).toHaveBeenCalledWith(expect.objectContaining({
      realmId: 'rlm-valid',
      owner: null,
      coachUserId: 'tg:101',
      clientUserId: 'tg:202',
      name: 'Тестовая программа',
      status: 'draft',
    }));
    await repository.refresh();
    expect(f.refresh).toHaveBeenCalledWith({ purpose: 'pull' });
    repository.close();
    expect(f.close).toHaveBeenCalledTimes(1);
  });

  it('does not create a plan for an unlinked client or itself', async () => {
    const f = fixture();
    const repository = new AssignedProgramsRepository('101', 'signed');
    await expect(repository.createAssigned('303', 'Чужая программа')).rejects.toThrow('Связь');
    await expect(repository.createAssigned('101', 'Своя программа')).rejects.toThrow('самому себе');
    await expect(repository.createAssigned('abc', 'Некорректно')).rejects.toThrow('Некорректный клиент');
    expect(f.add).not.toHaveBeenCalled();
  });

  it('fails closed when the supposed relationship realm has an owner', async () => {
    const f = fixture();
    f.db.realms.get.mockResolvedValue({ realmId: 'rlm-valid', owner: 'tg:101' });
    const repository = new AssignedProgramsRepository('101', 'signed');
    await expect(repository.createAssigned('202', 'Неавторизованно')).rejects.toThrow('Связь');
    expect(f.add).not.toHaveBeenCalled();
  });

  it('ignores foreign coach membership, even for a shared client', async () => {
    const f = fixture();
    f.roles.splice(0, 1, { userId: 'tg:101', realmId: 'rlm-valid', roles: ['client'] });
    const repository = new AssignedProgramsRepository('101', 'signed');
    await expect(repository.createAssigned('202', 'Нельзя')).rejects.toThrow('Связь');
    expect(f.add).not.toHaveBeenCalled();
  });
});
