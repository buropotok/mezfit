import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, getDexieCloudTokens } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getDexieCloudTokens', () => {
  it('uses the typed Worker API with signed initData, not a browser request to privileged cloud endpoints', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({
      type: 'tokens',
      claims: { sub: 'tg:42' },
      accessToken: 'access',
      accessTokenExpiration: Date.now() + 60_000,
      userType: 'prod',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const token = await getDexieCloudTokens('signed-init-data', { public_key: 'public-key' });
    expect(token.claims.sub).toBe('tg:42');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/dexie-cloud/tokens');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('x-telegram-init-data')).toBe('signed-init-data');
    expect(JSON.parse(String(init?.body))).toEqual({ public_key: 'public-key' });
  });

  it('rejects an invalid success response at the API boundary', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ ok: true })));
    await expect(getDexieCloudTokens('signed-init-data', { public_key: 'public-key' }))
      .rejects.toMatchObject({ code: 'INVALID_API_RESPONSE', status: 502 } satisfies Partial<ApiError>);
  });

  it('propagates unavailable cloud token exchange as a typed API error', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json(
      { error: { code: 'DEXIE_CLOUD_UNAVAILABLE', message: 'Not configured' } },
      { status: 503 },
    )));
    await expect(getDexieCloudTokens('signed-init-data', { public_key: 'public-key' }))
      .rejects.toBeInstanceOf(ApiError);
  });
});
