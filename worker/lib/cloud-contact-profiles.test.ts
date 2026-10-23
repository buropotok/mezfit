import { beforeEach, describe, expect, it, vi } from 'vitest';
import { relationshipMembership } from './dexie-cloud-membership';
import { syncOwnContactProfile, type ContactProfileEnv } from './cloud-contact-profiles';
import { validateTelegramInitData } from './telegram';

vi.mock('./telegram', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./telegram')>();
  return { ...actual, validateTelegramInitData: vi.fn() };
});

const jpeg = Uint8Array.from([255, 216, 255, 224, ...Array(32).fill(0)]);
const largeJpeg = Uint8Array.from([255, 216, 255, 224, ...Array(48).fill(0)]);
const transform = vi.fn((_stream: ReadableStream<Uint8Array>) => ({
  transform: ({ width }: { width: number }) => ({
    output: async () => ({
      response: () => new Response(width > 128 ? largeJpeg.slice() : jpeg.slice(), {
        headers: { 'content-type': 'image/jpeg' },
      }),
    }),
  }),
}));
const env = {
  IMAGES: { input: transform },
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
  type StoredBlob = { _bt: 'Blob'; ref: string; size: number; ct: 'image/jpeg' };
  type Profile = { id: string; realmId: string; owner: null; userId: string; name: string;
    avatarVersion: string | null; avatar: StoredBlob | null; avatarSmall?: StoredBlob | null;
    avatarLarge?: StoredBlob | null; _hasBlobRefs?: number; sourceAuthAt: number };
  const profiles = new Map<string, Profile>();
  let photo = 'photo-one';
  let noPhoto = false;
  let postCount = 0;
  let memberWrites = 0;
  let downloads = 0;
  let uploads = 0;
  let uploadFails = false;
  let invalidImage = false;
  let largeUploadFails = false;
  let photoLookupFails = false;
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
        name: string; avatarVersion: string | null; avatar: StoredBlob | null;
        avatarSmall?: StoredBlob | null; avatarLarge?: StoredBlob | null;
        _hasBlobRefs?: number; sourceAuthAt: number;
      }>;
      rows.forEach((profile) => profiles.set(profile.id, profile));
      return new Response(null, { status: 204 });
    }
    if (url.pathname.startsWith('/all/realms/')) return Response.json(pair.realm);
    if (url.pathname.startsWith('/blob/') && method === 'PUT') {
      uploads++;
      const written = new Uint8Array(init?.body as ArrayBuffer);
      if (uploadFails || (largeUploadFails && written.length === largeJpeg.length)) {
        return new Response(null, { status: 503 });
      }
      expect([jpeg.length, largeJpeg.length]).toContain(written.length);
      expect(written.slice(0, 3)).toEqual(new Uint8Array([255, 216, 255]));
      expect(init?.headers).toMatchObject({
        Authorization: 'Bearer manager',
        'Content-Type': 'image/jpeg',
      });
      return Response.json({ ref: '1:' + url.pathname.split('/').at(-1) });
    }
    if (url.pathname.endsWith('/getUserProfilePhotos')) {
      if (photoLookupFails) return new Response(null, { status: 503 });
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
    failLarge() { largeUploadFails = true; },
    resumeLarge() { largeUploadFails = false; },
    failPhotoLookup() { photoLookupFails = true; },
    resumePhotoLookup() { photoLookupFails = false; },
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
    expect(own.avatarSmall).toMatchObject({ _bt: 'Blob', size: jpeg.length, ct: 'image/jpeg' });
    expect(own.avatarLarge).toMatchObject({ _bt: 'Blob', size: largeJpeg.length, ct: 'image/jpeg' });
    expect(own.avatarSmall?.ref).toMatch(/^1:[a-f0-9]{64}$/);
    expect(own.avatarLarge?.ref).not.toBe(own.avatarSmall?.ref);
    expect(own.avatar).toBeNull();
    expect(own._hasBlobRefs).toBe(1);
    expect(cloud.uploads()).toBe(2);
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
    expect(cloud.uploads()).toBe(2);
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
    expect(cloud.uploads()).toBe(4);

    cloud.removePhoto();
    auth(101, new Date('2026-10-12T19:02:00Z'));
    await syncOwnContactProfile(request, env, cloud.fetchImpl);
    const removed = [...cloud.profiles.values()].find((profile) => profile.userId === 'tg:101')!;
    expect(removed.avatarVersion).toBeNull();
    expect(removed.avatar).toBeNull();
    expect(removed.avatarSmall).toBeNull();
    expect(removed.avatarLarge).toBeNull();
    expect(cloud.downloads()).toBe(2);
    expect(cloud.memberWrites()).toBe(0);
  });

  it('refreshes a watermarked Telegram avatar after reopening with the same auth_date', async () => {
    const cloud = await setup();
    const request = new Request('https://mezfit.test/api/cloud/profile/sync', {
      method: 'POST', headers: { 'x-telegram-init-data': 'same-signed-session' },
    });
    await syncOwnContactProfile(request, env, cloud.fetchImpl);
    const first = [...cloud.profiles.values()][0];
    const firstVersion = first.avatarVersion;

    // Telegram can keep initData/auth_date identical while its photo changes.
    cloud.setPhoto('new-watermarked-telegram-photo');
    const changed = await syncOwnContactProfile(request, env, cloud.fetchImpl);
    expect(await changed.json()).toEqual({ changed: true });
    const updated = [...cloud.profiles.values()][0];
    expect(updated.avatarVersion).not.toBe(firstVersion);
    expect(updated.avatarSmall?.ref).not.toBe(first.avatarSmall?.ref);
    expect(updated.avatarLarge?.ref).not.toBe(first.avatarLarge?.ref);
    expect(cloud.downloads()).toBe(2);
    expect(cloud.uploads()).toBe(4);

    // Checking again with no change must not download, upload or write.
    const unchanged = await syncOwnContactProfile(request, env, cloud.fetchImpl);
    expect(await unchanged.json()).toEqual({ changed: false });
    expect(cloud.downloads()).toBe(2);
    expect(cloud.uploads()).toBe(4);
    expect(cloud.postCount()).toBe(2);
  });

  it('preserves the newest name when two equal-auth-date sessions see the same avatar', async () => {
    const cloud = await setup();
    vi.mocked(validateTelegramInitData).mockImplementation(async (initData) => ({
      user: {
        id: 101,
        first_name: initData === 'new-session' ? 'Актуальное'
          : initData === 'old-session' ? 'Устаревшее' : 'Исходное',
        last_name: 'Имя',
      },
      authDate: initData === 'seed'
        ? new Date('2026-10-12T18:59:00Z') : FIRST_AUTH_AT,
    }));
    const request = (token: string) => new Request('https://mezfit.test/api/cloud/profile/sync', {
      method: 'POST', headers: { 'x-telegram-init-data': token },
    });
    await syncOwnContactProfile(request('seed'), env, cloud.fetchImpl);
    expect([...cloud.profiles.values()][0].name).toBe('Исходное Имя');

    let resumeOlder: (() => void) | undefined;
    const waiting = new Promise<void>(resolve => { resumeOlder = resolve; });
    let blocked = false;
    const delayedFetch = vi.fn<typeof fetch>(async (input, init) => {
      if (new URL(String(input)).pathname.endsWith('/getUserProfilePhotos') && !blocked) {
        blocked = true;
        await waiting;
      }
      return cloud.fetchImpl(input, init);
    });
    const pendingOlder = syncOwnContactProfile(request('old-session'), env, delayedFetch);
    await vi.waitFor(() => expect(blocked).toBe(true));

    const newest = await syncOwnContactProfile(request('new-session'), env, cloud.fetchImpl);
    expect(await newest.json()).toEqual({ changed: true });
    const committed = [...cloud.profiles.values()][0];
    expect(committed.name).toBe('Актуальное Имя');
    expect(committed.sourceAuthAt).toBe(FIRST_AUTH_AT.getTime());
    const writes = cloud.postCount();

    resumeOlder?.();
    expect(await (await pendingOlder).json()).toEqual({ changed: false });
    const persisted = [...cloud.profiles.values()][0];
    expect(persisted.name).toBe('Актуальное Имя');
    expect(persisted.avatarVersion).toBe(committed.avatarVersion);
    expect(cloud.postCount()).toBe(writes);
  });

  it('updates an avatar at the same auth_date without restoring a stale name', async () => {
    const cloud = await setup();
    const request = new Request('https://mezfit.test/api/cloud/profile/sync', {
      method: 'POST', headers: { 'x-telegram-init-data': 'signed' },
    });
    await syncOwnContactProfile(request, env, cloud.fetchImpl);
    const original = [...cloud.profiles.values()][0];

    cloud.setPhoto('changed-profile-photo');
    vi.mocked(validateTelegramInitData).mockResolvedValue({
      user: { id: 101, first_name: 'Устаревшее', last_name: 'Имя' },
      authDate: FIRST_AUTH_AT,
    });
    const updated = await syncOwnContactProfile(request, env, cloud.fetchImpl);
    expect(await updated.json()).toEqual({ changed: true });
    const persisted = [...cloud.profiles.values()][0];
    expect(persisted.name).toBe(original.name);
    expect(persisted.avatarVersion).not.toBe(original.avatarVersion);
    expect(persisted.avatarSmall?.ref).not.toBe(original.avatarSmall?.ref);
    expect(persisted.avatarLarge?.ref).not.toBe(original.avatarLarge?.ref);
  });

  it('does not overwrite a newer avatar observed in a concurrent equal-auth-date launch', async () => {
    const cloud = await setup();
    const request = new Request('https://mezfit.test/api/cloud/profile/sync', {
      method: 'POST', headers: { 'x-telegram-init-data': 'same-signed-session' },
    });
    await syncOwnContactProfile(request, env, cloud.fetchImpl);

    let resumeOlder: (() => void) | undefined;
    const waiting = new Promise<void>(resolve => { resumeOlder = resolve; });
    let blocked = false;
    const delayedFetch = vi.fn<typeof fetch>(async (input, init) => {
      if (new URL(String(input)).pathname.endsWith('/getFile') && !blocked) {
        blocked = true;
        await waiting;
      }
      return cloud.fetchImpl(input, init);
    });

    cloud.setPhoto('older-observation');
    const pending = syncOwnContactProfile(request, env, delayedFetch);
    await vi.waitFor(() => expect(blocked).toBe(true));

    cloud.setPhoto('latest-watermarked-photo');
    await syncOwnContactProfile(request, env, cloud.fetchImpl);
    const latest = [...cloud.profiles.values()][0];
    resumeOlder?.();
    expect(await (await pending).json()).toEqual({ changed: false });
    const persisted = [...cloud.profiles.values()][0];
    expect(persisted.avatarVersion).toBe(latest.avatarVersion);
    expect(persisted.avatarSmall?.ref).toBe(latest.avatarSmall?.ref);
    expect(persisted.avatarLarge?.ref).toBe(latest.avatarLarge?.ref);
    expect(cloud.postCount()).toBe(2);
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
    expect(after.avatarSmall).toEqual(before.avatarSmall);
    expect(after.avatarLarge).toEqual(before.avatarLarge);
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

  it('repairs a missing large variant on the same Telegram session without reuploading small', async () => {
    const cloud = await setup();
    cloud.failLarge();
    const request = new Request('https://mezfit.test/api/cloud/profile/sync', {
      method: 'POST', headers: { 'x-telegram-init-data': 'signed' },
    });
    await syncOwnContactProfile(request, env, cloud.fetchImpl);
    const first = [...cloud.profiles.values()][0];
    expect(first.avatarSmall).toMatchObject({ _bt: 'Blob' });
    expect(first.avatarLarge).toBeNull();
    expect(cloud.uploads()).toBe(2);
    cloud.resumeLarge();
    await syncOwnContactProfile(request, env, cloud.fetchImpl);
    const repaired = [...cloud.profiles.values()][0];
    expect(repaired.avatarLarge).toMatchObject({ _bt: 'Blob' });
    expect(repaired.avatarSmall?.ref).toBe(first.avatarSmall?.ref);
    expect(cloud.uploads()).toBe(3);
  });

  it('retries an unavailable Telegram photo with the same verified initData', async () => {
    const cloud = await setup();
    const request = new Request('https://mezfit.test/api/cloud/profile/sync', {
      method: 'POST', headers: { 'x-telegram-init-data': 'signed' },
    });
    cloud.failPhotoLookup();
    await syncOwnContactProfile(request, env, cloud.fetchImpl);
    expect([...cloud.profiles.values()][0].avatarVersion).toBeNull();
    cloud.resumePhotoLookup();
    await syncOwnContactProfile(request, env, cloud.fetchImpl);
    expect([...cloud.profiles.values()][0].avatarSmall).toMatchObject({ _bt: 'Blob' });
    expect([...cloud.profiles.values()][0].avatarLarge).toMatchObject({ _bt: 'Blob' });
    expect(cloud.uploads()).toBe(2);
  });

  it('upgrades an existing one-size Dexie avatar even with the same signed auth time', async () => {
    const cloud = await setup();
    const { stableCloudRelationshipId } = await import('../../shared/relationship-id');
    const id = await stableCloudRelationshipId('prf', cloud.pair.realm.realmId + ':tg:101');
    cloud.profiles.set(id, {
      id, realmId: cloud.pair.realm.realmId, owner: null, userId: 'tg:101',
      name: 'Новый Профиль', avatarVersion: 'a'.repeat(64),
      avatar: { _bt: 'Blob', ref: '1:legacy', ct: 'image/jpeg', size: 36 },
      sourceAuthAt: FIRST_AUTH_AT.getTime(),
    });
    await syncOwnContactProfile(new Request('https://mezfit.test/api/cloud/profile/sync', {
      method: 'POST', headers: { 'x-telegram-init-data': 'signed' },
    }), env, cloud.fetchImpl);
    expect(cloud.profiles.get(id)?.avatarSmall).toMatchObject({ _bt: 'Blob' });
    expect(cloud.profiles.get(id)?.avatarLarge).toMatchObject({ _bt: 'Blob' });
    expect(cloud.profiles.get(id)?.avatar).toBeNull();
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
    expect(cloud.profiles.get(id)?.avatarSmall).toMatchObject({ _bt: 'Blob' });
    expect(cloud.profiles.get(id)?.avatarLarge).toMatchObject({ _bt: 'Blob' });
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
  it('distinguishes a stored avatar from an upload failure in an explicit diagnostic without exposing identifiers', async () => {
    const cloud = await setup();
    const request = new Request('https://mezfit.test/api/cloud/profile/sync?diagnostic=1', {
      method: 'POST', headers: { 'x-telegram-init-data': 'signed' },
    });
    cloud.failUpload();
    const failed = await (await syncOwnContactProfile(request, env, cloud.fetchImpl)).json();
    expect(failed).toEqual({ changed: true, avatarStatus: 'upload-failed' });
    expect([...cloud.profiles.values()][0].avatarVersion).toBeNull();
    expect(JSON.stringify(failed)).not.toContain('photo-one');

    const plain = await (await syncOwnContactProfile(new Request(
      'https://mezfit.test/api/cloud/profile/sync', {
        method: 'POST', headers: { 'x-telegram-init-data': 'signed' },
      },
    ), env, cloud.fetchImpl)).json();
    expect(plain).toEqual({ changed: false });
  });

  it('reports actual Telegram photo changes and does not attribute an unchanged photo to the cache', async () => {
    const cloud = await setup();
    const request = new Request('https://mezfit.test/api/cloud/profile/sync?diagnostic=1', {
      method: 'POST', headers: { 'x-telegram-init-data': 'signed' },
    });
    expect(await (await syncOwnContactProfile(request, env, cloud.fetchImpl)).json())
      .toEqual({ changed: true, avatarStatus: 'updated' });
    expect(await (await syncOwnContactProfile(request, env, cloud.fetchImpl)).json())
      .toEqual({ changed: false, avatarStatus: 'unchanged' });
    cloud.setPhoto('new-photo');
    expect(await (await syncOwnContactProfile(request, env, cloud.fetchImpl)).json())
      .toEqual({ changed: true, avatarStatus: 'updated' });
    cloud.failPhotoLookup();
    expect(await (await syncOwnContactProfile(request, env, cloud.fetchImpl)).json())
      .toEqual({ changed: false, avatarStatus: 'telegram-unavailable' });
  });


});
