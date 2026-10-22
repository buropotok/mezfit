// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MezfitCloudDatabase } from './database';
import { loadContactAvatar, type AvatarTraceStage } from './contact-avatar-cache';
import { stableCloudRelationshipId } from '../../../shared/relationship-id';

const peer = {
  relationshipId: 'rlm' + 'a'.repeat(28),
  userId: 'tg:202',
  avatarVersion: 'b'.repeat(64),
};
const image = new Blob([new Uint8Array([255, 216, 255, ...Array(33).fill(0)])], {
  type: 'image/jpeg',
});
let current: {
  id: string; realmId: string; userId: string; owner: null | string;
  avatarVersion: string | null; avatar: Blob | null;
  avatarSmall?: Blob | null; avatarLarge?: Blob | null;
} | undefined;
const get = vi.fn(async (id: string) => id === current?.id ? current : undefined);
const db = { contactProfiles: { get } } as unknown as MezfitCloudDatabase;

beforeEach(async () => {
  vi.clearAllMocks();
  current = {
    id: await stableCloudRelationshipId('prf', peer.relationshipId + ':' + peer.userId),
    realmId: peer.relationshipId, userId: peer.userId, owner: null,
    avatarVersion: peer.avatarVersion, avatar: null, avatarSmall: image,
    avatarLarge: new Blob([new Uint8Array(100)], { type: 'image/jpeg' }),
  };
});

describe('Dexie Cloud local-first contact avatars', () => {
  it('returns the authorized JPEG from local Dexie without network requests', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const trace: AvatarTraceStage[] = [];
    const result = await loadContactAvatar(db, peer, stage => trace.push(stage));
    expect(result).toBe(image);
    expect(get).toHaveBeenCalledWith(current?.id);
    expect(fetcher).not.toHaveBeenCalled();
    expect(trace).toEqual(['reading-dexie', 'blob-validated']);
    fetcher.mockRestore();
  });

  it('does not read malformed or missing references', async () => {
    expect(await loadContactAvatar(db, { ...peer, avatarVersion: null })).toBeNull();
    expect(await loadContactAvatar(db, { ...peer, relationshipId: 'incorrect' })).toBeNull();
    expect(await loadContactAvatar(db, { ...peer, userId: 'tg:wrong' })).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it('rejects wrong realm, user and ownership even when a blob exists', async () => {
    if (!current) throw new Error('MISSING_FIXTURE');
    for (const changed of [
      { realmId: 'rlm' + 'c'.repeat(28) },
      { userId: 'tg:303' },
      { owner: 'tg:101' },
    ]) {
      current = { ...current, ...changed };
      expect(await loadContactAvatar(db, peer)).toBeNull();
    }
  });

  it('rejects stale versions, malformed images and absent local profiles', async () => {
    if (!current) throw new Error('MISSING_FIXTURE');
    current.avatarVersion = 'c'.repeat(64);
    expect(await loadContactAvatar(db, peer)).toBeNull();
    current.avatarVersion = peer.avatarVersion;
    current.avatarSmall = new Blob(['small']);
    expect(await loadContactAvatar(db, peer)).toBeNull();
    current = undefined;
    expect(await loadContactAvatar(db, peer)).toBeNull();
  });

  it('selects the large image explicitly without affecting the default small image', async () => {
    expect(await loadContactAvatar(db, peer)).toBe(image);
    expect(await loadContactAvatar(db, peer, undefined, 'large')).toBe(current?.avatarLarge);
  });

  it('supports the pre-migration single Dexie blob until variants are published', async () => {
    if (!current) throw new Error('MISSING_FIXTURE');
    current.avatar = image;
    current.avatarSmall = null;
    current.avatarLarge = null;
    expect(await loadContactAvatar(db, peer)).toBe(image);
    expect(await loadContactAvatar(db, peer, undefined, 'large')).toBe(image);
  });

  it('never serves an optimized small blob over 50 KB', async () => {
    if (!current) throw new Error('MISSING_FIXTURE');
    current.avatarSmall = new Blob([new Uint8Array(50_001)]);
    expect(await loadContactAvatar(db, peer)).toBeNull();
    expect(await loadContactAvatar(db, peer, undefined, 'large')).not.toBeNull();
  });

  it('isolates local Dexie read errors and reports only safe stage names', async () => {
    get.mockRejectedValueOnce(new Error('private ID'));
    const trace: AvatarTraceStage[] = [];
    expect(await loadContactAvatar(db, peer, stage => trace.push(stage))).toBeNull();
    expect(trace).toEqual(['reading-dexie', 'indexeddb-error']);
  });
});
