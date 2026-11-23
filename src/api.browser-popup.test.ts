import { afterEach, expect, it, vi } from 'vitest';
import { completeBrowserLogin, prepareBrowserLogin } from './api';

afterEach(() => { vi.unstubAllGlobals(); });

it('uses a same-origin POST challenge and returns to the legacy flow only if the method is absent', async () => {
  const challenge = { clientId: 123, nonce: 'a'.repeat(43), expiresIn: 300 };
  const request = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(challenge))
    .mockResolvedValueOnce(new Response(null, { status: 405 }));
  vi.stubGlobal('fetch', request);
  const { signal } = new AbortController();
  await expect(prepareBrowserLogin(signal)).resolves.toEqual(challenge);
  expect(request).toHaveBeenCalledWith('/auth/start', expect.objectContaining({ method: 'POST', signal }));
  await expect(prepareBrowserLogin(signal)).resolves.toBeNull();
});

it('sends the token only in the callback body and reads identity from the server session', async () => {
  const identity = { telegramUserId: '123', name: 'Mezfit', username: '' };
  const request = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ authenticated: true, telegramUserId: '456' }))
    .mockResolvedValueOnce(Response.json({ authenticated: true, ...identity }));
  vi.stubGlobal('fetch', request);
  const { signal } = new AbortController();
  await expect(completeBrowserLogin('test-token', signal)).resolves.toEqual(identity);
  expect(request).toHaveBeenNthCalledWith(1, '/auth/callback', expect.objectContaining({
    method: 'POST', credentials: 'same-origin', redirect: 'error', body: '{"idToken":"test-token"}',
  }));
  expect(request).toHaveBeenNthCalledWith(2, '/auth/session', expect.objectContaining({ method: 'GET' }));
});
