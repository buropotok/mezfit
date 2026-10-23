import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MezfitCloudDatabase } from './database';
import {
  CoachClientAvatarRepository, isOwnCoachClientAvatar, type CoachClientAvatarRow,
} from './coach-client-avatars';

const relationshipId = 'rlm' + 'a'.repeat(28);
const target = { relationshipId, userId: 'tg:202' };
const jpeg = (size: number) => new Blob([new Uint8Array(size)], { type: 'image/jpeg' });

let rows: Map<string, CoachClientAvatarRow>;
const get = vi.fn(async (id: string) => rows.get(id));
const put = vi.fn(async (row: CoachClientAvatarRow) => {
  rows.set(row.id, row);
  return row.id;
});
const remove = vi.fn(async (id: string) => { rows.delete(id); });

const db = {
  coachClientAvatars: { get, put, delete: remove },
} as unknown as Pick<MezfitCloudDatabase, 'coachClientAvatars'>;

beforeEach(() => {
  vi.clearAllMocks();
  rows = new Map();
});

describe('private coach contact avatar repository', () => {
  it('saves optimized images to the coach personal realm with one version and reads them locally', async () => {
    const repository = new CoachClientAvatarRepository(db, 'tg:101');
    const small = jpeg(32);
    const large = jpeg(64);
    await repository.save(target, small, large);
    const row = [...rows.values()][0];
    expect(row).toMatchObject({
      realmId: 'tg:101', owner: 'tg:101',
      clientUserId: 'tg:202', relationshipId,
    });
    expect(row.version).toMatch(/^[a-f0-9-]{36}$/);
    expect(isOwnCoachClientAvatar(row, 'tg:101', target)).toBe(true);
    expect(await repository.load(target, row.version, 'small')).toBe(small);
    expect(await repository.load(target, row.version, 'large')).toBe(large);
    expect(await repository.load(target, 'different')).toBeNull();

    await repository.save(target, small, large);
    expect(put).toHaveBeenCalledTimes(2);
    expect([...rows.values()][0].version).not.toBe(row.version);
    await repository.remove(target);
    expect(rows.size).toBe(0);
  });

  it('never reads, deletes or promotes another coach private portrait', async () => {
    const repository = new CoachClientAvatarRepository(db, 'tg:101');
    const foreign: CoachClientAvatarRow = {
      id: 'coach-client-avatar:' + relationshipId,
      realmId: 'tg:999', owner: 'tg:999',
      relationshipId, clientUserId: 'tg:202',
      version: crypto.randomUUID(), avatarSmall: jpeg(36), avatarLarge: jpeg(64),
    };
    rows.set(foreign.id, foreign);
    expect(await repository.load(target, foreign.version)).toBeNull();
    await expect(repository.remove(target)).rejects.toThrow('INVALID_COACH_AVATAR_OWNER');
    expect(remove).not.toHaveBeenCalled();
    expect(rows.has(foreign.id)).toBe(true);
  });

  it('rejects invalid clients and out-of-policy payloads before Dexie writes', async () => {
    const repository = new CoachClientAvatarRepository(db, 'tg:101');
    await expect(repository.save(
      { relationshipId, userId: 'tg:101' }, jpeg(32), jpeg(64),
    )).rejects.toThrow('INVALID_COACH_AVATAR_TARGET');
    await expect(repository.save(target, jpeg(50_001), jpeg(64)))
      .rejects.toThrow('INVALID_COACH_AVATAR_IMAGE');
    await expect(repository.save(target, jpeg(32), new Blob(['bad'], { type: 'text/plain' })))
      .rejects.toThrow('INVALID_COACH_AVATAR_IMAGE');
    expect(put).not.toHaveBeenCalled();
  });
});
