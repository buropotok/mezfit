import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acceptCurrentInvite, getCurrentInvite } from './api';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('invite API launch context', () => {
  it('forwards the current invite launch parameter when checking an invite', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ invite: null }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await getCurrentInvite('telegram-init', `invite_${'b'.repeat(36)}`);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('x-telegram-init-data')).toBe('telegram-init');
    expect(headers.get('x-mezfit-invite-start-param')).toBe(`invite_${'b'.repeat(36)}`);
  });

  it('forwards the same invite launch parameter when accepting an invite', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, roles: ['client'] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await acceptCurrentInvite('telegram-init', `invite_${'b'.repeat(36)}`);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(init.method).toBe('POST');
    expect(headers.get('x-telegram-init-data')).toBe('telegram-init');
    expect(headers.get('x-mezfit-invite-start-param')).toBe(`invite_${'b'.repeat(36)}`);
  });
  it('rejects an invalid invitation preview instead of rendering a broken coach identity', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      invite: { label: null, expiresAt: '2026-11-22', coach: { firstName: 123, lastName: null, username: null } },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(getCurrentInvite('telegram-init', `invite_${'b'.repeat(36)}`))
      .rejects.toMatchObject({ status: 502, code: 'INVALID_API_RESPONSE' });
  });

  it('rejects acceptance responses without a confirmed client role', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, roles: ['coach'] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));

    await expect(acceptCurrentInvite('telegram-init', `invite_${'b'.repeat(36)}`))
      .rejects.toMatchObject({ status: 502, code: 'INVALID_API_RESPONSE' });
  });

  it('rejects extra untrusted roles in an invitation acceptance response', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, roles: ['client', 'admin'] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));

    await expect(acceptCurrentInvite('telegram-init', `invite_${'b'.repeat(36)}`))
      .rejects.toMatchObject({ status: 502, code: 'INVALID_API_RESPONSE' });
  });

});
