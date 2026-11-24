import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkBrowserDexieCloudToken, getBrowserSession, logoutBrowserSession } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('browser Dexie token diagnostic', () => {
  it('uses the same-origin session and returns only the status and identity match', async () => {
    const token = {
      type: 'tokens', userType: 'prod', claims: { sub: 'tg:123' },
      accessToken: 'must-not-return', refreshToken: 'must-not-return', accessTokenExpiration: 123456,
    };
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(token))
      .mockResolvedValueOnce(Response.json({ ...token, claims: { sub: 'tg:456' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { signal } = new AbortController();

    await expect(checkBrowserDexieCloudToken('public-key', '123', signal))
      .resolves.toEqual({ status: 200, subjectMatches: true });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/dexie-cloud/tokens', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ public_key: 'public-key' }), signal,
    });
    await expect(checkBrowserDexieCloudToken('public-key', '123', signal))
      .resolves.toEqual({ status: 200, subjectMatches: false });
  });

  it('retains the HTTP status for rejected or invalid responses', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ claims: { sub: 'tg:123' } })));
    const { signal } = new AbortController();

    await expect(checkBrowserDexieCloudToken('public-key', '123', signal))
      .resolves.toEqual({ status: 401, subjectMatches: null });
    await expect(checkBrowserDexieCloudToken('public-key', '123', signal))
      .resolves.toEqual({ status: 200, subjectMatches: null });
  });
});

describe('browser authentication API', () => {
  it('reads a verified identity using the same-origin cookie and forwards cancellation', async () => {
    const identity = { telegramUserId: '123', name: 'Example User', username: 'example' };
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ authenticated: true, ...identity }));
    vi.stubGlobal('fetch', fetchMock);
    const { signal } = new AbortController();

    await expect(getBrowserSession(signal)).resolves.toEqual(identity);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/auth/session', {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', signal,
    });
  });

  it('distinguishes an absent session from an HTTP failure or an invalid success response', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ authenticated: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getBrowserSession()).resolves.toBeNull();
    await expect(getBrowserSession()).rejects.toMatchObject({ name: 'ApiError', status: 503 });
    await expect(getBrowserSession()).rejects.toMatchObject({ code: 'INVALID_API_RESPONSE' });
  });

  it('requires a server confirmation of logout and uses a same-origin POST', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ authenticated: false }))
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response('<html>Mezfit</html>'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(logoutBrowserSession()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/auth/logout', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: undefined,
    });
    await expect(logoutBrowserSession()).rejects.toMatchObject({ name: 'ApiError', status: 403 });
    await expect(logoutBrowserSession()).rejects.toMatchObject({ code: 'INVALID_API_RESPONSE' });
  });
});
