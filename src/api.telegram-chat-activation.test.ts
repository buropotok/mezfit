import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMezfitChatActivation } from './api';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('Telegram chat activation API', () => {
  it('sends signed initData and decodes a verified boolean', async () => {
    fetchMock.mockResolvedValue(Response.json({ activated: true }));
    expect(await getMezfitChatActivation('signed-init')).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/telegram/chat-activation');
    expect(new Headers(init.headers).get('x-telegram-init-data')).toBe('signed-init');
  });

  it('returns false when the bot is not yet activated', async () => {
    fetchMock.mockResolvedValue(Response.json({ activated: false }));
    expect(await getMezfitChatActivation('signed-init')).toBe(false);
  });

  it.each([{}, { activated: 'true' }, { activated: null }])('rejects malformed responses', async payload => {
    fetchMock.mockResolvedValue(Response.json(payload));
    await expect(getMezfitChatActivation('signed-init'))
      .rejects.toMatchObject({ status: 502, code: 'INVALID_API_RESPONSE' });
  });

  it('preserves unavailable-activation errors instead of treating them as approval', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: { code: 'TELEGRAM_CHAT_CHECK_UNAVAILABLE' } }, { status: 503 }));
    await expect(getMezfitChatActivation('signed-init'))
      .rejects.toMatchObject({ status: 503, code: 'TELEGRAM_CHAT_CHECK_UNAVAILABLE' });
  });
});
