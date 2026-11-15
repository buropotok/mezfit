import { describe, expect, it, vi, afterEach } from 'vitest';
import { handleDiscussionR2MediaRoute, signDiscussionR2Get } from './discussion-media-r2';
import { relationshipMembership } from './dexie-cloud-membership';

const key = 'mvp-media/' + 'a'.repeat(64);
const secret = '123456:unit-test-token';
const credentials = {
  R2_ACCOUNT_ID: 'a'.repeat(32), R2_MEDIA_ACCESS_KEY_ID: 'TESTACCESSKEY12345',
  R2_MEDIA_SECRET_ACCESS_KEY: 'test-secret-signing-key',
};
const messageId = '22222222-2222-4222-8222-222222222222';
const attachmentId = '33333333-3333-4333-8333-333333333333';
const threadId = '44444444-4444-4444-8444-444444444444';
const encoder = new TextEncoder();
const head = vi.fn(async () => ({ size: 6, httpMetadata: { contentType: 'image/jpeg' } }));

async function telegramInitData(userId: number): Promise<string> {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId, first_name: 'Tester' }),
  });
  const data = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([a, b]) => a + '=' + b).join('\n');
  const imported = await crypto.subtle.importKey('raw', encoder.encode('WebAppData'),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const keyBytes = await crypto.subtle.sign('HMAC', imported, encoder.encode(secret));
  const hmac = await crypto.subtle.importKey('raw', keyBytes,
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const hash = new Uint8Array(await crypto.subtle.sign('HMAC', hmac, encoder.encode(data)));
  params.set('hash', [...hash].map(byte => byte.toString(16).padStart(2, '0')).join(''));
  return params.toString();
}

const env = () => ({
  TELEGRAM_BOT_TOKEN: secret,
  R2_BINDING_DISCUSSION_MEDIA: { head } as unknown as R2Bucket,
  DEXIE_CLOUD_REMINDER_CLIENT_ID: 'test-reader',
  DEXIE_CLOUD_REMINDER_CLIENT_SECRET: 'test-only-secret',
  ...credentials,
});

function request(body: object): Request {
  return new Request('https://mezfit.example/api/discussion-media/read', {
    method: 'POST', headers: { Origin: 'https://mezfit.example', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function mockCloud(overrides: {
  members?: unknown[]; message?: Record<string, unknown> | null;
  attachment?: Record<string, unknown> | null; thread?: Record<string, unknown> | null;
  realm?: Record<string, unknown> | null;
} = {}) {
  const pair = await relationshipMembership('100500', '200600');
  const data = {
    members: pair.members,
    realm: pair.realm,
    message: { id: messageId, realmId: pair.realm.realmId, threadId,
      owner: 'tg:100500', authorUserId: 'tg:100500', deletedAt: '' },
    attachment: { id: attachmentId, messageId, realmId: pair.realm.realmId,
      owner: 'tg:100500', authorUserId: 'tg:100500', storageKey: key, mimeType: 'image/jpeg',
      sizeBytes: 6, uploadState: 'ready', confirmedAt: '2026-11-16T00:00:00.000Z' },
    thread: { id: threadId, realmId: pair.realm.realmId, coachClientId: pair.realm.realmId,
      owner: pair.realm.realmId },
    ...overrides,
  };
  const upstream = vi.fn<typeof fetch>(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === '/token') {
      expect(init?.method).toBe('POST');
      const body = JSON.parse(String(init?.body)) as { scopes: string[] };
      expect(body.scopes).toEqual(['ACCESS_DB', 'GLOBAL_READ']);
      return Response.json({ type: 'tokens', accessToken: 'reader-token' });
    }
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer reader-token');
    if (path === '/all/members') return Response.json(data.members);
    if (path === '/all/realms/' + pair.realm.realmId) return data.realm
      ? Response.json(data.realm) : new Response(null, { status: 404 });
    if (path === '/all/discussionMessages/' + messageId) return data.message
      ? Response.json(data.message) : new Response(null, { status: 404 });
    if (path === '/all/messageAttachments/' + attachmentId) return data.attachment
      ? Response.json(data.attachment) : new Response(null, { status: 404 });
    if (path === '/all/discussionThreads/' + threadId) return data.thread
      ? Response.json(data.thread) : new Response(null, { status: 404 });
    throw new Error('Unexpected Dexie read: ' + path);
  });
  vi.stubGlobal('fetch', upstream);
  return { realmId: pair.realm.realmId, data, upstream };
}

afterEach(() => { vi.unstubAllGlobals(); head.mockReset(); head.mockResolvedValue({
  size: 6, httpMetadata: { contentType: 'image/jpeg' },
}); });

describe('Private R2 discussion media reads', () => {
  it('signs short-lived GET for native Range playback without exposing the credential', async () => {
    const signed = await signDiscussionR2Get(key, credentials, new Date('2026-11-15T18:00:00Z'));
    const url = new URL(signed.getUrl);
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(url.searchParams.get('X-Amz-Signature'))
      .toBe('a3982586ebe25d49219a8cc2d2632db1a78886e48a5bdcc78295c845668e8281');
    expect(signed.expiresAt).toBe(new Date('2026-11-15T18:10:00Z').getTime());
    expect(signed.getUrl).not.toContain(credentials.R2_MEDIA_SECRET_ACCESS_KEY);
  });

  it('permits an authenticated relationship member only for an exact published attachment', async () => {
    const { realmId } = await mockCloud();
    const good = { initData: await telegramInitData(200600), realmId, messageId,
      attachmentId, storageKey: key, contentType: 'image/jpeg', sizeBytes: 6 };
    const response = await handleDiscussionR2MediaRoute(request(good), env());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const result = await response.json() as { getUrl: string; storageKey: string };
    expect(result.storageKey).toBe(key);
    expect(result.getUrl).toContain('/' + key + '?');
    expect(head).toHaveBeenCalledWith(key);
  });

  it('refuses a valid Telegram user who is not a member of the requested relationship', async () => {
    const { realmId } = await mockCloud();
    const response = await handleDiscussionR2MediaRoute(request({
      initData: await telegramInitData(300700), realmId, messageId, attachmentId, storageKey: key,
      contentType: 'image/jpeg', sizeBytes: 6,
    }), env());
    expect(response.status).toBe(403);
    expect(head).not.toHaveBeenCalled();
  });

  it.each([
    { attachment: { storageKey: 'mvp-media/' + 'b'.repeat(64) } },
    { attachment: { uploadState: 'pending' } },
    { attachment: { messageId: 'different-message' } },
    { attachment: { realmId: 'rlm' + 'f'.repeat(28) } },
    { attachment: { deletedAt: '2026-11-16T00:00:00.000Z' } },
    { message: { deletedAt: '2026-11-16T00:00:00.000Z' } },
  ])('refuses an absent, unpublished, deleted or mismatched attachment', async overrides => {
    const { realmId, data } = await mockCloud();
    if (overrides.attachment) data.attachment = { ...data.attachment, ...overrides.attachment };
    if (overrides.message) data.message = { ...data.message, ...overrides.message };
    const response = await handleDiscussionR2MediaRoute(request({
      initData: await telegramInitData(200600), realmId, messageId, attachmentId,
      storageKey: key, contentType: 'image/jpeg', sizeBytes: 6,
    }), env());
    expect(response.status).toBe(403);
    expect(head).not.toHaveBeenCalled();
  });

  it('denies a revoked relationship even when the actor still knows the R2 object key', async () => {
    const pair = await relationshipMembership('100500', '200600');
    const members = pair.members.map(member => member.userId === 'tg:200600'
      ? { ...member, accepted: false } : member);
    const { realmId } = await mockCloud({ members });
    const response = await handleDiscussionR2MediaRoute(request({
      initData: await telegramInitData(200600), realmId, messageId,
      attachmentId, storageKey: key, contentType: 'image/jpeg', sizeBytes: 6,
    }), env());
    expect(response.status).toBe(403);
    expect(head).not.toHaveBeenCalled();
  });

  it('rejects invalid auth, forged realm inputs and absent service credentials', async () => {
    const { realmId } = await mockCloud();
    const good = { initData: await telegramInitData(200600), realmId, messageId, attachmentId,
      storageKey: key, contentType: 'image/jpeg', sizeBytes: 6 };
    expect((await handleDiscussionR2MediaRoute(request({ ...good, initData: 'bad' }), env())).status).toBe(401);
    expect((await handleDiscussionR2MediaRoute(request({ ...good, realmId: 'rlm-fake' }), env())).status).toBe(400);
    expect((await handleDiscussionR2MediaRoute(request(good), {
      ...env(), DEXIE_CLOUD_REMINDER_CLIENT_ID: undefined,
    })).status).toBe(503);
    expect(head).not.toHaveBeenCalled();
  });

  it('never signs a GET when the private R2 object is absent or has different metadata', async () => {
    const { realmId } = await mockCloud();
    const good = { initData: await telegramInitData(200600), realmId, messageId,
      attachmentId, storageKey: key, contentType: 'image/jpeg', sizeBytes: 6 };
    head.mockResolvedValueOnce(null as unknown as Awaited<ReturnType<typeof head>>);
    expect((await handleDiscussionR2MediaRoute(request(good), env())).status).toBe(404);
    head.mockResolvedValueOnce({ size: 7, httpMetadata: { contentType: 'image/jpeg' } });
    expect((await handleDiscussionR2MediaRoute(request(good), env())).status).toBe(409);
  });
});
