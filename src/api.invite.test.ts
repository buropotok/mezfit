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
});
