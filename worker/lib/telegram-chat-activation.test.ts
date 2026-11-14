import { describe, expect, it, vi } from 'vitest';
import { telegramChatIsActivated } from './telegram-chat-activation';

const PRIVATE_CHAT = { ok: true, result: { id: 101, type: 'private' } };

describe('Telegram private chat activation', () => {
  it('accepts only a matching, accessible private chat', async () => {
    const request = vi.fn<typeof fetch>(async (_url, init) => {
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({ chat_id: '101' });
      return Response.json(PRIVATE_CHAT);
    });
    expect(await telegramChatIsActivated('101', 'secret', request)).toBe(true);
    expect(request).toHaveBeenCalledOnce();
  });

  it.each([400, 403])('keeps the activation gate closed on Telegram %i', async status => {
    const request = vi.fn<typeof fetch>(async () => Response.json({
      ok: false, description: status === 400 ? 'Bad Request: chat not found' : 'Forbidden: bot was blocked',
    }, { status }));
    expect(await telegramChatIsActivated('101', 'secret', request)).toBe(false);
  });

  it('does not mistake another private chat or a group for the current account', async () => {
    const other = vi.fn<typeof fetch>(async () => Response.json({ ok: true, result: { id: 202, type: 'private' } }));
    const group = vi.fn<typeof fetch>(async () => Response.json({ ok: true, result: { id: 101, type: 'group' } }));
    await expect(telegramChatIsActivated('101', 'secret', other)).rejects.toThrow('TELEGRAM_CHAT_CHECK_UNAVAILABLE');
    await expect(telegramChatIsActivated('101', 'secret', group)).rejects.toThrow('TELEGRAM_CHAT_CHECK_UNAVAILABLE');
  });

  it('fails closed on Telegram outages, invalid configuration or transport errors', async () => {
    const failure = vi.fn<typeof fetch>(async () => new Response(null, { status: 502 }));
    await expect(telegramChatIsActivated('101', 'secret', failure)).rejects.toThrow('TELEGRAM_CHAT_CHECK_UNAVAILABLE');
    await expect(telegramChatIsActivated('101', '', failure)).rejects.toThrow('TELEGRAM_CHAT_CHECK_UNAVAILABLE');
    await expect(telegramChatIsActivated('invalid', 'secret', failure)).rejects.toThrow('TELEGRAM_CHAT_CHECK_UNAVAILABLE');
    expect(failure).toHaveBeenCalledOnce();
    const offline = vi.fn<typeof fetch>(async () => { throw new TypeError('offline'); });
    await expect(telegramChatIsActivated('101', 'secret', offline)).rejects.toThrow('TELEGRAM_CHAT_CHECK_UNAVAILABLE');
  });
});
