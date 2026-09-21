import { afterEach, describe, expect, it, vi } from 'vitest';
import { acceptCurrentInvite, getCurrentInvite } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('invite API launch parameter transport', () => {
  it('forwards the Telegram launch parameter when previewing an invite', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ invite: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await getCurrentInvite('signed-init-data', 'invite_fallback');

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(requestInit.headers);
    expect(headers.get('x-telegram-init-data')).toBe('signed-init-data');
    expect(headers.get('x-telegram-start-param')).toBe('invite_fallback');
  });

  it('forwards the same launch parameter when accepting an invite', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, roles: ['client'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await acceptCurrentInvite('signed-init-data', 'invite_fallback');

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(requestInit.headers);
    expect(requestInit.method).toBe('POST');
    expect(headers.get('x-telegram-start-param')).toBe('invite_fallback');
  });
});
