import { beforeEach, describe, expect, it, vi } from 'vitest';
import { relationshipMembership } from './dexie-cloud-membership';
import { syncOwnContactProfile, type ContactProfileEnv } from './cloud-contact-profiles';
import { validateTelegramInitData } from './telegram';

vi.mock('./telegram', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./telegram')>();
  return { ...actual, validateTelegramInitData: vi.fn() };
});

const jpeg = Uint8Array.from([255, 216, 255, 224, ...Array(32).fill(0)]);
const env = {
  TELEGRAM_BOT_TOKEN: 'test-bot-secret',
  DEXIE_CLOUD_CLIENT_ID: 'auth-id',
  DEXIE_CLOUD_CLIENT_SECRET: 'auth-secret',
  DEXIE_CLOUD_MEMBERSHIP_CLIENT_ID: 'manager-id',
  DEXIE_CLOUD_MEMBERSHIP_CLIENT_SECRET: 'manager-secret',
} as unknown as ContactProfileEnv;

const FIRST_AUTH_AT = new Date('2026-10-12T19:00:00Z');
const auth = (id: number, authDate = FIRST_AUTH_AT) => {
  vi.mocked(validateTelegramInitData).mockResolvedValue({
    user: { id, first_name: id === 101 ? 'Новый' : 'Клиент', last_name: 'Профиль' },
    authDate,
  });
};

async function setup() {
  const pair = await relationshipMembership('101', '202');
  const members = pair.members.map((member) => ({ ...member, name: undefined as string | undefined, avatarVersion: undefined as string | null | undefined }));
  const store = new Map(members.map((member) => [member.id, member]));
  const profiles = new Map<string, { id: string; realmId: string; owner: null; userId: string; name: string; avatarVersion: string | null; avatar: { _bt: 'Blob'; ref: string; size: number; ct: 'image/jpeg' } | null; _hasBlobRefs?: number; sourceAuthAt: number }>();
  let photo = 'photo-one';
  let noPhoto = false;
  let postCount = 0;
  let memberWrites = 0;
  let downloads = 0;
  let uploads = 0;
  let uploadFails = false;
  let invalidImage = false;
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    if (url.pathname === '/token') return Response.json({ type: 'tokens', accessToken: 'manager' });
    if (url.pathname === '/all/members' && method === 'GET') {
      const value = [...store.values()].filter((member) =>
        url.searchParams.has('realmId') ? member.realmId === url.searchParams.get('realmId')
          : member.userId === url.searchParams.get('userId'));
      return Response.json(value);
    }
    if (url.pathname === '/all/members' && method === 'POST') {
      memberWrites++;
      const rows = JSON.parse(String(init?.body)) as typeof members;
      rows.forEach((member) => store.set(member.id, member));
      return new Response(null, { status: 204 });
    }
    if (url.pathname === '/all/contactProfiles' && method === 'GET') {
      return Response.json([...profiles.values()].filter((profile) =>
        url.searchParams.has('realmId') ? profile.realmId === url.searchParams.get('realmId')
          : profile.userId === url.searchParams.get('userId')));
    }
    if (url.pathname === '/all/contactProfiles' && method === 'POST') {
      postCount++;
      const rows = JSON.parse(String(init?.body)) as Array<{
        id: string; realmId: string; owner: null; userId: string;
        name: string; avatarVersion: string | null; avatar: { _bt: 'Blob'; ref: string; size: number; ct: 'image/jpeg' } | null; _hasBlobRefs?: number; sourceAuthAt: number;
      }>;
      rows.forEach((profile) => profiles.set(profile.id, profile));
      return new Response(null, { status: 204 });
    }
    if (url.pathname.startsWith('/all/realms/')) return Response.json(pair.realm);
    if (url.pathname.startsWith('/blob/') && method === 'PUT') {
      uploads++;
      if (uploadFails) return new Response(null, { status: 503 });
      expect(new Uint8Array(init?.body as ArrayBuffer)).toEqual(jpeg);
      expect(init?.headers).toMatchObject({
        Authorization: 'Bearer manager',
        'Content-Type': 'image/jpeg',
      });
      return Response.json({ ref: '1:' + url.pathname.split('/').at(-1) });
    }
    if (url.pathname.endsWith('/getUserProfilePhotos')) {
      return Response.json({ ok: true, result: {
        photos: noPhoto ? [] : [[{ file_id: photo, file_unique_id: photo }]],
      } });
    }
    if (url.pathname.endsWith('/getFile')) {
      return Response.json({ ok: true, result: { file_path: 'photos/active.jpg' } });
    }
    if (url.pathname.startsWith('/file/bot')) {
      downloads++;
      return new Response(invalidImage ? new Uint8Array(36) : jpeg.slice(), {
        headers: { 'content-type': 'image/jpeg' },
      });
    }
    throw new Error('unexpected test route');
  });
  return {
    pair, store, profiles, fetchImpl, postCount: () => postCount,
    memberWrites: () => memberWrites, downloads: () => downloads, uploads: () => uploads,
    setPhoto(value: string) { photo = value; },
    removePhoto() { noPhoto = true; },
    failUpload() { uploadFails = true; },
    invalidateImage() { invalidImage = true; },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  auth(101);
});

describe('privileged Telegram contact profile synchronization', () => {
  it('stores Telegram JPEG in Dexie Cloud profiles once, without R2 or duplicate uploads', async () => {
    const cloud = await setup();
    const request = new Request('https://mezfit.test/api/cloud/profile/sync', {
      method: 'POST', headers: { 'x-telegram-init-data': 'signed' },
    });
    expect((await syncOwnContactProfile(request, env, cloud.fetchImpl)).status).toBe(200);
    const own = [...cloud.profiles.values()].find((profile) => profile.userId === 'tg:101')!;
    expect(own.name).toBe('Новый Профиль');
    expect(own.avatarVersion).toMatch(/^[a-f0-9]{64}$/);
    const membership = [...cloud.store.values()].find((member) => member.userId === 'tg:101')!;
    expect(membership.roles).toEqual(['coach']);
    expect(membership.owner).toBeNull();
    expect(membership.accepted).toBe(true);
    expect(membership.name).toBeUndefined();
    expect(cloud.memberWrites()).toBe(0);
    expect(cloud.postCount()).toBe(1);
    expect(cloud.downloads()).toBe(1);

    expect((await (await syncOwnContactProfile(request, env, cloud.fetchImpl)).json())).toEqual({ changed: false });
    expect(cloud.postCount()).toBe(1);
    expect(cloud.downloads()).toBe(1);
    expect(own.avatar).toMatchObject({ _bt: 'Blob', size: jpeg.length, ct: 'image/jpeg' });
    expect(own.avatar?.ref).toMatch(/^1:[a-f0-9]{64}$/);
    expect(own._hasBlobRefs).toBe(1);
    expect(cloud.uploads()).toBe(1);
  });

  it('updates only a changed Telegram name without downloading a new avatar', async () => {
    const cloud = await setup();
    const request = new Request('https://mezfit.test/api/cloud/profile/sync', {
      method: 'POST', headers: { 'x-telegram-init-data': 'signed' },
    });
    await syncOwnContactProfile(request, env, cloud.fetchImpl);
    const firstDownloads = cloud.downloads();
    const firstWrites = cloud.postCount();
    vi.mocked(validateTelegramInitData).mockResolvedValue({
      user: { id: 101, first_name: 'Новое', last_name: 'Имя' },
      authDate: new Date('2026-10-12T19:01:00Z'),
    });
    await syncOwnContactProfile(request, env, cloud.fetchImpl);
    const current = [...cloud.profiles.values()].find((profile) => profile.userId === 'tg:101')!;
    expect(current.name).toBe('Новое Имя');
    expect(cloud.downloads()).toBe(firstDownloads);
    expect(cloud.postCount()).toBe(firstWrites + 1);
    expect(current._hasBlobRefs).toBe(1);
    expect(cloud.uploads()).toBe(1);
  });

  it('refreshes only the changed avatar version and preserves existing relationship metadata', async () => {
    const cloud = await setup();
    const request = new Request('https://mezfit.test/api/cloud/profile/sync', {
      method: 'POST', headers: { 'x-telegram-init-data': 'signed' },
    });
    await syncOwnContactProfile(request, env, cloud.fetchImpl);
    const original = [...cloud.profiles.values()].find((profile) => profile.userId === 'tg:101')!;
    const version = original.avatarVersion;
    cloud.setPhoto('photo-two');
    auth(101, new Date('2026-10-12T19:01:00Z'));
    await syncOwnContactProfile(request, env, cloud.fetchImpl);
    const updated = [...cloud.profiles.values()].find((profile) => profile.userId === 'tg:101')!;
    expect(updated.avatarVersion).not.toBe(version);
    expect(updated.name).toBe(original.name);
    expect(updated.realmId).toBe(original.realmId);
    expect(cloud.downloads()).toBe(2);
    expect(cloud.uploads()).toBe(2);

    cloud.removePhoto();
    auth(101, new Date('2026-10-12T19:02:00Z'));
    await syncOwnContactProfile(request, env, cloud.fetchImpl);
    const removed = [...cloud.profiles.values()].find((profile) => profile.userId === 'tg:101')!;
    expect(removed.avatarVersion).toBeNull();
    expect(removed.avatar).toBeNull();
    expect(cloud.downloads()).toBe(2);
    expect(cloud.memberWrites()).toBe(0);
  });

  it('keeps an existing cloud avatar if new blob upload fails and still updates the name', async () => {
    const cloud = await setup();
    const request = new Request('https://mezfit.test/api/cloud/profile/sync', {
      method: 'POST', headers: { 'x-telegram-init-data': 'signed' },
    });
    await syncOwnContactProfile(request, env, cloud.fetchImpl);
    const before = [...cloud.profiles.values()][0];
    cloud.setPhoto('photo-replacement');
    cloud.failUpload();
    vi.mocked(validateTelegramInitData).mockResolvedValue({
      user: { id: 101, first_name: 'Новое', last_name: 'Имя' },
      authDate: new Date('2026-10-12T19:01:00Z'),
    });
    await syncOwnContactProfile(request, env, cloud.fetchImpl);
    const after = [...cloud.profiles.values()][0];
    expect(after.name).toBe('Новое Имя');
    expect(after.avatarVersion).toBe(before.avatarVersion);
    expect(after.avatar).toEqual(before.avatar);
    expect(after._hasBlobRefs).toBe(1);
  });

  it('does not publish malformed image bytes to Dexie Cloud', async () => {
    const cloud = await setup();
    cloud.invalidateImage();
    const request = new Request('https://mezfit.test/api/cloud/profile/sync', {
      method: 'POST', headers: { 'x-telegram-init-data': 'signed' },
    });
    await syncOwnContactProfile(request, env, cloud.fetchImpl);
    const profile = [...cloud.profiles.values()][0];
    expect(profile.name).toBe('Новый Профиль');
    expect(profile.avatarVersion).toBeNull();
    expect(profile.avatar).toBeNull();
    expect(cloud.uploads()).toBe(0);
  });

  it('does not restore an older verified Telegram name after a newer session saved it', async () => {
    const cloud = await setup();
    const request = new Request('https://mezfit.test/api/cloud/profile/sync', {
      method: 'POST', headers: { 'x-telegram-init-data': 'signed' },
    });
    await syncOwnContactProfile(request, env, cloud.fetchImpl);

    vi.mocked(validateTelegramInitData).mockResolvedValue({
      user: { id: 101, first_name: 'Последнее', last_name: 'Имя' },
      authDate: new Date('2026-10-12T19:02:00Z'),
    });
    await syncOwnContactProfile(request, env, cloud.fetchImpl);
    const writes = cloud.postCount();

    vi.mocked(validateTelegramInitData).mockResolvedValue({
      user: { id: 101, first_name: 'Устаревшее', last_name: 'Имя' },
      authDate: new Date('2026-10-12T19:01:00Z'),
    });
    expect((await (await syncOwnContactProfile(request, env, cloud.fetchImpl)).json()))
      .toEqual({ changed: false });
    const saved = [...cloud.profiles.values()].find((profile) => profile.userId === 'tg:101')!;
    expect(saved.name).toBe('Последнее Имя');
    expect(saved.sourceAuthAt).toBe(new Date('2026-10-12T19:02:00Z').getTime());
    expect(cloud.postCount()).toBe(writes);
    expect(cloud.memberWrites()).toBe(0);
  });

  it('rechecks the newest source timestamp when an older photo lookup finishes late', async () => {
    const cloud = await setup();
    let resumeOld: (() => void) | undefined;
    const waitOld = new Promise<void>((resolve) => { resumeOld = resolve; });
    let olderPhotoStarted = false;
    const delayedFetch = vi.fn<typeof fetch>(async (input, init) => {
      if (new URL(String(input)).pathname.endsWith('/getUserProfilePhotos') && !olderPhotoStarted) {
        olderPhotoStarted = true;
        await waitOld;
      }
      return cloud.fetchImpl(input, init);
    });
    vi.mocked(validateTelegramInitData).mockImplementation(async (initData) => ({
      user: {
        id: 101,
        first_name: initData === 'old-session' ? 'Старое' : 'Новое',
        last_name: 'Имя',
      },
      authDate: new Date(initData === 'old-session'
        ? '2026-10-12T19:01:00Z' : '2026-10-12T19:02:00Z'),
    }));
    const oldRequest = new Request('https://mezfit.test/api/cloud/profile/sync', {
      method: 'POST', headers: { 'x-telegram-init-data': 'old-session' },
    });
    const newerRequest = new Request('https://mezfit.test/api/cloud/profile/sync', {
      method: 'POST', headers: { 'x-telegram-init-data': 'new-session' },
    });
    const pendingOlder = syncOwnContactProfile(oldRequest, env, delayedFetch);
    await vi.waitFor(() => expect(olderPhotoStarted).toBe(true));
    await syncOwnContactProfile(newerRequest, env, cloud.fetchImpl);
    resumeOld?.();
    expect((await (await pendingOlder).json())).toEqual({ changed: false });
    const saved = [...cloud.profiles.values()].find((profile) => profile.userId === 'tg:101')!;
    expect(saved.name).toBe('Новое Имя');
    expect(saved.sourceAuthAt).toBe(new Date('2026-10-12T19:02:00Z').getTime());
    expect(cloud.postCount()).toBe(1);
  });

  it('replaces legacy R2-only version with a JPEG stored in Dexie Cloud', async () => {
    const cloud = await setup();
    const { realmId } = cloud.pair.realm;
    const { stableCloudRelationshipId } = await import('../../shared/relationship-id');
    const id = await stableCloudRelationshipId('prf', realmId + ':tg:101');
    cloud.profiles.set(id, {
      id, realmId, owner: null, userId: 'tg:101', name: 'Новый Профиль',
      avatarVersion: 'a'.repeat(64), avatar: null,
      sourceAuthAt: new Date('2026-10-12T18:00:00Z').getTime(),
    });
    const result = await syncOwnContactProfile(new Request('https://mezfit.test/api/cloud/profile/sync', {
      method: 'POST', headers: { 'x-telegram-init-data': 'signed' },
    }), env, cloud.fetchImpl);
    expect(result.status).toBe(200);
    expect(cloud.profiles.get(id)?.avatar).toMatchObject({ _bt: 'Blob' });
    expect(cloud.downloads()).toBe(1);
  });

  it('never writes another member profile or unvalidated relationship', async () => {
    const cloud = await setup();
    const outsider = new Request('https://mezfit.test/api/cloud/profile/sync', {
      method: 'POST', headers: { 'x-telegram-init-data': 'signed' },
    });
    auth(303);
    expect((await (await syncOwnContactProfile(outsider, env, cloud.fetchImpl)).json())).toEqual({ changed: false });
    expect(cloud.postCount()).toBe(0);

    auth(101);
    const target = [...cloud.store.values()].find((member) => member.userId === 'tg:101')!;
    target.owner = 'tg:101' as never;
    await syncOwnContactProfile(outsider, env, cloud.fetchImpl);
    expect(cloud.postCount()).toBe(0);
    expect(cloud.memberWrites()).toBe(0);
  });
});
