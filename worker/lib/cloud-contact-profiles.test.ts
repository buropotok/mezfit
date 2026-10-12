import { beforeEach, describe, expect, it, vi } from 'vitest';
import { relationshipMembership } from './dexie-cloud-membership';
import { getContactAvatar, syncOwnContactProfile, type ContactProfileEnv } from './cloud-contact-profiles';
import { validateTelegramInitData } from './telegram';

vi.mock('./telegram', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./telegram')>();
  return { ...actual, validateTelegramInitData: vi.fn() };
});

const jpeg = Uint8Array.from([255, 216, 255, 224, ...Array(32).fill(0)]);
const objects = new Map<string, ArrayBuffer>();
const head = vi.fn(async (key: string) => objects.has(key) ? { key } : null);
const put = vi.fn(async (key: string, bytes: ArrayBuffer) => { objects.set(key, bytes); });
const get = vi.fn(async (key: string) => objects.has(key)
  ? { body: new Blob([objects.get(key)!], { type: 'image/jpeg' }).stream() } : null);
const env = {
  TELEGRAM_BOT_TOKEN: 'test-bot-secret',
  DEXIE_CLOUD_CLIENT_ID: 'auth-id',
  DEXIE_CLOUD_CLIENT_SECRET: 'auth-secret',
  DEXIE_CLOUD_MEMBERSHIP_CLIENT_ID: 'manager-id',
  DEXIE_CLOUD_MEMBERSHIP_CLIENT_SECRET: 'manager-secret',
  R2_BINDING_MEZFIT: { head, put, get },
} as unknown as ContactProfileEnv;

const auth = (id: number) => {
  vi.mocked(validateTelegramInitData).mockResolvedValue({
    user: { id, first_name: id === 101 ? 'Новый' : 'Клиент', last_name: 'Профиль' },
    authDate: new Date(),
  });
};

async function setup() {
  const pair = await relationshipMembership('101', '202');
  const members = pair.members.map((member) => ({ ...member, name: undefined as string | undefined, avatarVersion: undefined as string | null | undefined }));
  const store = new Map(members.map((member) => [member.id, member]));
  let photo = 'photo-one';
  let noPhoto = false;
  let postCount = 0;
  let downloads = 0;
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
      postCount++;
      const rows = JSON.parse(String(init?.body)) as typeof members;
      rows.forEach((member) => store.set(member.id, member));
      return new Response(null, { status: 204 });
    }
    if (url.pathname.startsWith('/all/realms/')) return Response.json(pair.realm);
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
      return new Response(jpeg.slice(), { headers: { 'content-type': 'image/jpeg' } });
    }
    throw new Error('unexpected test route');
  });
  return {
    pair, store, fetchImpl, postCount: () => postCount, downloads: () => downloads,
    setPhoto(value: string) { photo = value; },
    removePhoto() { noPhoto = true; },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  objects.clear();
  auth(101);
});

describe('privileged Telegram contact profile synchronization', () => {
  it('updates absent names and R2 avatar once, then skips identical writes and downloads', async () => {
    const cloud = await setup();
    const request = new Request('https://mezfit.test/api/cloud/profile/sync', {
      method: 'POST', headers: { 'x-telegram-init-data': 'signed' },
    });
    expect((await syncOwnContactProfile(request, env, cloud.fetchImpl)).status).toBe(200);
    const own = [...cloud.store.values()].find((member) => member.userId === 'tg:101')!;
    expect(own.name).toBe('Новый Профиль');
    expect(own.avatarVersion).toMatch(/^[a-f0-9]{64}$/);
    expect(own.roles).toEqual(['coach']);
    expect(own.owner).toBeNull();
    expect(own.accepted).toBe(true);
    expect(cloud.postCount()).toBe(1);
    expect(cloud.downloads()).toBe(1);

    expect((await (await syncOwnContactProfile(request, env, cloud.fetchImpl)).json())).toEqual({ changed: false });
    expect(cloud.postCount()).toBe(1);
    expect(cloud.downloads()).toBe(1);
    expect(put).toHaveBeenCalledTimes(1);
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
      authDate: new Date(),
    });
    await syncOwnContactProfile(request, env, cloud.fetchImpl);
    const current = [...cloud.store.values()].find((member) => member.userId === 'tg:101')!;
    expect(current.name).toBe('Новое Имя');
    expect(cloud.downloads()).toBe(firstDownloads);
    expect(cloud.postCount()).toBe(firstWrites + 1);
  });

  it('refreshes only the changed avatar version and preserves existing relationship metadata', async () => {
    const cloud = await setup();
    const request = new Request('https://mezfit.test/api/cloud/profile/sync', {
      method: 'POST', headers: { 'x-telegram-init-data': 'signed' },
    });
    await syncOwnContactProfile(request, env, cloud.fetchImpl);
    const original = [...cloud.store.values()].find((member) => member.userId === 'tg:101')!;
    const version = original.avatarVersion;
    cloud.setPhoto('photo-two');
    await syncOwnContactProfile(request, env, cloud.fetchImpl);
    const updated = [...cloud.store.values()].find((member) => member.userId === 'tg:101')!;
    expect(updated.avatarVersion).not.toBe(version);
    expect(updated.name).toBe(original.name);
    expect(updated.realmId).toBe(original.realmId);
    expect(cloud.downloads()).toBe(2);

    cloud.removePhoto();
    await syncOwnContactProfile(request, env, cloud.fetchImpl);
    const removed = [...cloud.store.values()].find((member) => member.userId === 'tg:101')!;
    expect(removed.avatarVersion).toBeNull();
    expect(cloud.downloads()).toBe(2);
  });

  it('serves a cached R2 photo only to real members of the linked canonical realm', async () => {
    const cloud = await setup();
    await syncOwnContactProfile(new Request('https://mezfit.test/api/cloud/profile/sync', {
      method: 'POST', headers: { 'x-telegram-init-data': 'signed' },
    }), env, cloud.fetchImpl);
    const version = [...cloud.store.values()].find((member) => member.userId === 'tg:101')?.avatarVersion;
    expect(version).toBeTruthy();
    const url = `https://mezfit.test/api/cloud/profile/avatar?userId=tg%3A101&realmId=${cloud.pair.realm.realmId}&version=${version}`;
    auth(202);
    const request = new Request(url, { headers: { 'x-telegram-init-data': 'signed' } });
    const allowed = await getContactAvatar(request, env, cloud.fetchImpl);
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('content-type')).toBe('image/jpeg');
    expect(allowed.headers.get('cache-control')).toContain('no-store');

    auth(303);
    expect((await getContactAvatar(request, env, cloud.fetchImpl)).status).toBe(404);
    auth(202);
    expect((await getContactAvatar(new Request(url.replace(String(version), '0'.repeat(64)), {
      headers: { 'x-telegram-init-data': 'signed' },
    }), env, cloud.fetchImpl)).status).toBe(404);
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
  });
});
