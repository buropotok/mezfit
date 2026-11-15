import { describe, expect, it, vi } from 'vitest';
import { handleDiscussionR2MediaRoute, signDiscussionR2Put } from './discussion-media-r2';

const encoder = new TextEncoder();
const key = 'mvp-media/' + 'a'.repeat(64);
const secret = '123456:unit-test-token';
const accountId = 'a'.repeat(32);
const credentials = {
  R2_ACCOUNT_ID: accountId,
  R2_MEDIA_ACCESS_KEY_ID: 'TESTACCESSKEY12345',
  R2_MEDIA_SECRET_ACCESS_KEY: 'test-secret-signing-key',
};
function buffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
async function hmac(bytes: Uint8Array, data: string): Promise<Uint8Array> {
  const imported = await crypto.subtle.importKey('raw', buffer(bytes), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, encoder.encode(data)));
}
async function initData(userId = 100500): Promise<string> {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: userId, first_name: 'Athlete' }),
  });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([a, b]) => `${a}=${b}`).join('\n');
  const key = await hmac(encoder.encode('WebAppData'), secret);
  const hash = await hmac(key, check);
  params.set('hash', Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join(''));
  return params.toString();
}
const head = vi.fn(async () => ({ size: 6, httpMetadata: { contentType: 'image/jpeg' } }));
function env() {
  return { TELEGRAM_BOT_TOKEN: secret, R2_BINDING_DISCUSSION_MEDIA: { head } as unknown as R2Bucket,
    ...credentials };
}
function request(path: string, body: object): Request {
  return new Request(`https://mezfit.example/api/discussion-media/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://mezfit.example' },
    body: JSON.stringify(body),
  });
}
describe('Cloudflare R2 upload signer', () => {
  it('matches an independent SigV4 test vector and signs immutable upload headers', async () => {
    const signed = await signDiscussionR2Put({ storageKey: key, contentType: 'image/jpeg', sizeBytes: 6 },
      credentials, new Date('2026-11-15T18:00:00Z'));
    expect(new URL(signed.putUrl).searchParams.get('X-Amz-Signature'))
      .toBe('4603e7c69b7dfef4c66a62052746249615f8a92a99ab13dceca103cc6df0164b');
    expect(signed.putUrl).toContain('X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost%3Bif-none-match');
    expect(signed.putUrl).not.toContain(credentials.R2_MEDIA_SECRET_ACCESS_KEY);
    expect(signed.expiresAt).toBe(new Date('2026-11-15T18:10:00Z').getTime());
  });

  it('checks Telegram authentication before signing and validates untrusted upload parameters', async () => {
    const good = { initData: await initData(), storageKey: key, contentType: 'image/jpeg', sizeBytes: 6 };
    expect((await handleDiscussionR2MediaRoute(request('sign', { ...good, initData: '' }), env())).status).toBe(401);
    expect((await handleDiscussionR2MediaRoute(request('sign', { ...good, contentType: 'text/html' }), env())).status).toBe(400);
    for (const inheritedMime of ['constructor', 'toString', '__proto__']) {
      expect((await handleDiscussionR2MediaRoute(request('sign', { ...good, contentType: inheritedMime }), env())).status)
        .toBe(400);
    }
    expect((await handleDiscussionR2MediaRoute(request('sign', { ...good, sizeBytes: 250 * 1024 * 1024 }), env())).status).toBe(400);
    expect((await handleDiscussionR2MediaRoute(request('sign', { ...good, storageKey: '../other' }), env())).status).toBe(400);
    const signed = await handleDiscussionR2MediaRoute(request('sign', good), env());
    expect(signed.status).toBe(200);
    expect(signed.headers.get('cache-control')).toBe('no-store');
    const payload = await signed.json() as { storageKey: string; putUrl: string };
    expect(payload.storageKey).toBe(key);
    expect(payload.putUrl).toMatch(/^https:\/\/mezfit-discussion-media\.[a-f0-9]{32}\.r2\.cloudflarestorage\.com\//);
  });

  it('fails closed without R2 credentials and refuses cross-origin/browser-less forgery', async () => {
    const good = { initData: await initData(), storageKey: key, contentType: 'image/jpeg', sizeBytes: 6 };
    expect((await handleDiscussionR2MediaRoute(request('sign', good),
      { TELEGRAM_BOT_TOKEN: secret, R2_BINDING_DISCUSSION_MEDIA: { head } as unknown as R2Bucket })).status).toBe(503);
    const foreign = new Request('https://mezfit.example/api/discussion-media/sign', {
      method: 'POST', headers: { Origin: 'https://evil.example' }, body: JSON.stringify(good),
    });
    expect((await handleDiscussionR2MediaRoute(foreign, env())).status).toBe(403);
  });

  it('allows any authenticated Telegram user without a separate user-ID allowlist', async () => {
    for (const userId of [100500, 200600]) {
      const valid = { initData: await initData(userId), storageKey: key, contentType: 'image/jpeg', sizeBytes: 6 };
      expect((await handleDiscussionR2MediaRoute(request('sign', valid), env())).status).toBe(200);
      expect((await handleDiscussionR2MediaRoute(request('verify', valid), env())).status).toBe(200);
    }
    const invalid = { initData: 'user=200600&hash=bad', storageKey: key, contentType: 'image/jpeg', sizeBytes: 6 };
    expect((await handleDiscussionR2MediaRoute(request('sign', invalid), env())).status).toBe(401);
    expect((await handleDiscussionR2MediaRoute(request('verify', invalid), env())).status).toBe(401);
  });

  it('verifies the stored object MIME and length after a conditional PUT collision', async () => {
    const good = { initData: await initData(), storageKey: key, contentType: 'image/jpeg', sizeBytes: 6 };
    head.mockResolvedValueOnce({ size: 6, httpMetadata: { contentType: 'image/jpeg' } });
    expect((await handleDiscussionR2MediaRoute(request('verify', good), env())).status).toBe(200);
    head.mockResolvedValueOnce({ size: 7, httpMetadata: { contentType: 'image/jpeg' } });
    expect((await handleDiscussionR2MediaRoute(request('verify', good), env())).status).toBe(409);
    expect(head).toHaveBeenCalledWith(key);
  });
});
