import { afterEach, describe, expect, it, vi } from 'vitest';
import { cloudUserId, handleDexieCloudTokenRoute } from './dexie-cloud-tokens';

const encoder = new TextEncoder();
const tokenEnv = {
  TELEGRAM_BOT_TOKEN: '123456:unit-test-token',
  DEXIE_CLOUD_CLIENT_ID: 'test-client-id',
  DEXIE_CLOUD_CLIENT_SECRET: 'test-client-secret',
};

function arrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

async function hmac(key: Uint8Array, payload: string): Promise<Uint8Array> {
  const imported = await crypto.subtle.importKey(
    'raw', arrayBuffer(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, encoder.encode(payload)));
}

async function signedTelegramData(): Promise<string> {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: 100500, first_name: 'Athlete', last_name: 'Test' }),
  });
  const check = Array.from(params.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = await hmac(encoder.encode('WebAppData'), tokenEnv.TELEGRAM_BOT_TOKEN);
  const signature = await hmac(secret, check);
  params.set('hash', Array.from(signature, (byte) => byte.toString(16).padStart(2, '0')).join(''));
  return params.toString();
}

function request(initData: string, payload: unknown = { public_key: 'device-public-key' }): Request {
  return new Request('https://mezfit.example/api/dexie-cloud/tokens', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-init-data': initData,
    },
    body: JSON.stringify(payload),
  });
}

function tokenResponse(sub = 'tg:100500'): Response {
  return Response.json({
    type: 'tokens',
    claims: { sub },
    accessToken: 'user-access-token',
    accessTokenExpiration: Date.now() + 60_000,
    refreshToken: 'user-refresh-token',
    userType: 'prod',
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Dexie Cloud Telegram token exchange', () => {
  it('issues ACCESS_DB only for verified Telegram identity and ignores injected user hints', async () => {
    const upstream = vi.fn<typeof fetch>(async () => tokenResponse());
    const initData = await signedTelegramData();
    const response = await handleDexieCloudTokenRoute(
      request(initData, { public_key: 'device-public-key', hints: { userId: 'tg:999' } }),
      tokenEnv, upstream,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const data = await response.json() as { accessToken: string };
    expect(data.accessToken).toBe('user-access-token');
    expect(upstream).toHaveBeenCalledTimes(1);
    const [url, options] = upstream.mock.calls[0];
    expect(url).toBe('https://zjv60oxag.dexie.cloud/token');
    const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      grant_type: 'client_credentials',
      scopes: ['ACCESS_DB'],
      public_key: 'device-public-key',
      client_id: 'test-client-id',
      client_secret: 'test-client-secret',
      claims: { sub: 'tg:100500', name: 'Athlete Test' },
    });
    expect(JSON.stringify(body)).not.toContain('tg:999');
  });

  it('rejects requests without signed Telegram initData before contacting Dexie Cloud', async () => {
    const upstream = vi.fn<typeof fetch>(async () => tokenResponse());
    const response = await handleDexieCloudTokenRoute(request(''), tokenEnv, upstream);
    expect(response.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('fails closed when the service secrets are not configured', async () => {
    const upstream = vi.fn<typeof fetch>(async () => tokenResponse());
    const response = await handleDexieCloudTokenRoute(
      request(await signedTelegramData()), { TELEGRAM_BOT_TOKEN: tokenEnv.TELEGRAM_BOT_TOKEN }, upstream,
    );
    expect(response.status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('rejects missing public keys', async () => {
    const upstream = vi.fn<typeof fetch>(async () => tokenResponse());
    const response = await handleDexieCloudTokenRoute(
      request(await signedTelegramData(), { public_key: 42 }), tokenEnv, upstream,
    );
    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('rejects a token for a different user rather than forwarding it', async () => {
    const upstream = vi.fn<typeof fetch>(async () => tokenResponse('tg:999'));
    const response = await handleDexieCloudTokenRoute(
      request(await signedTelegramData()), tokenEnv, upstream,
    );
    expect(response.status).toBe(502);
    expect((await response.text())).not.toContain('user-access-token');
  });

  it('does not disclose upstream errors or privileged credentials', async () => {
    const upstream = vi.fn<typeof fetch>(async () => new Response('secret-token-value', { status: 403 }));
    const response = await handleDexieCloudTokenRoute(
      request(await signedTelegramData()), tokenEnv, upstream,
    );
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('secret-token-value');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('cloudUserId', () => {
  it('maps Telegram identities deterministically without relying on D1 IDs', () => {
    expect(cloudUserId(100500)).toBe('tg:100500');
    expect(() => cloudUserId(0)).toThrow('INVALID_TELEGRAM_USER_ID');
  });
});

describe('safe Dexie Cloud upstream diagnostics', () => {
  it('logs only the upstream HTTP status and fixed failure stage', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const upstream = vi.fn<typeof fetch>(async () => new Response(
      'sensitive upstream response: test-client-secret user-access-token',
      { status: 403 },
    ));
    const response = await handleDexieCloudTokenRoute(
      request(await signedTelegramData()), tokenEnv, upstream,
    );

    expect(response.status).toBe(502);
    expect(log.mock.calls).toEqual([[
      'DEXIE_CLOUD_TOKEN_EXCHANGE_FAILED',
      { stage: 'http', upstreamStatus: 403 },
    ]]);
    expect(JSON.stringify(log.mock.calls)).not.toContain('test-client-secret');
    expect(JSON.stringify(log.mock.calls)).not.toContain('user-access-token');
  });

  it('logs a null upstream status for network errors without revealing exception details', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const upstream = vi.fn<typeof fetch>(async () => {
      throw new Error('secret request data must stay private');
    });
    const response = await handleDexieCloudTokenRoute(
      request(await signedTelegramData()), tokenEnv, upstream,
    );

    expect(response.status).toBe(502);
    expect(log.mock.calls).toEqual([[
      'DEXIE_CLOUD_TOKEN_EXCHANGE_FAILED',
      { stage: 'fetch', upstreamStatus: null },
    ]]);
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret request data');
  });

  it('distinguishes invalid upstream JSON from a rejected HTTP response', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const upstream = vi.fn<typeof fetch>(async () => new Response(
      'not-json-sensitive-response-content',
      { status: 200 },
    ));
    const response = await handleDexieCloudTokenRoute(
      request(await signedTelegramData()), tokenEnv, upstream,
    );

    expect(response.status).toBe(502);
    expect(log.mock.calls).toEqual([[
      'DEXIE_CLOUD_TOKEN_EXCHANGE_FAILED',
      { stage: 'json', upstreamStatus: 200 },
    ]]);
    expect(JSON.stringify(log.mock.calls)).not.toContain('not-json-sensitive-response-content');
  });

  it('identifies an invalid token envelope without logging tokens or identity', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const upstream = vi.fn<typeof fetch>(async () => tokenResponse('tg:999'));
    const response = await handleDexieCloudTokenRoute(
      request(await signedTelegramData()), tokenEnv, upstream,
    );

    expect(response.status).toBe(502);
    expect(log.mock.calls).toEqual([[
      'DEXIE_CLOUD_TOKEN_EXCHANGE_FAILED',
      { stage: 'contract', upstreamStatus: 200 },
    ]]);
    expect(JSON.stringify(log.mock.calls)).not.toContain('tg:999');
    expect(JSON.stringify(log.mock.calls)).not.toContain('user-access-token');
  });

  it('does not emit failure diagnostics for valid exchange or pre-upstream rejection', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const initData = await signedTelegramData();
    const upstream = vi.fn<typeof fetch>(async () => tokenResponse());

    expect((await handleDexieCloudTokenRoute(request(initData), tokenEnv, upstream)).status).toBe(200);
    expect((await handleDexieCloudTokenRoute(request(''), tokenEnv, upstream)).status).toBe(401);
    expect((await handleDexieCloudTokenRoute(
      request(initData), { TELEGRAM_BOT_TOKEN: tokenEnv.TELEGRAM_BOT_TOKEN }, upstream,
    )).status).toBe(503);
    expect((await handleDexieCloudTokenRoute(request(initData, { public_key: 12 }), tokenEnv, upstream)).status).toBe(400);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });
});
