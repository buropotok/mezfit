import { beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index';
import { TelegramAuthError, validateTelegramInitData } from './lib/telegram';
import { telegramChatIsActivated } from './lib/telegram-chat-activation';

vi.mock('./lib/telegram', async importOriginal => ({
  ...await importOriginal<typeof import('./lib/telegram')>(),
  validateTelegramInitData: vi.fn(),
}));
vi.mock('./lib/telegram-chat-activation', () => ({ telegramChatIsActivated: vi.fn() }));

const actor = {
  id: 2, telegram_user_id: '202', username: null, first_name: 'Client',
  last_name: null, language_code: 'ru', photo_url: null, is_premium: 0,
};
const identity = vi.mocked(validateTelegramInitData);
const chat = vi.mocked(telegramChatIsActivated);

function fixture() {
  const prepare = vi.fn((sql: string) => ({
    bind: () => ({
      first: async () => {
        if (sql.includes('FROM app_user') && sql.includes('WHERE telegram_user_id = ?')) return actor;
        throw new Error('Unexpected SQL: ' + sql);
      },
      all: async () => {
        if (sql === 'SELECT role FROM user_role WHERE user_id = ? ORDER BY role') {
          return { results: [{ role: 'client' }] };
        }
        throw new Error('Unexpected SQL: ' + sql);
      },
    }),
  }));
  return { TELEGRAM_BOT_TOKEN: 'test-token', DB_BINDING: { prepare }, ASSETS: { fetch: vi.fn() } } as unknown as Env;
}

beforeEach(() => {
  identity.mockReset();
  chat.mockReset();
  identity.mockResolvedValue({
    user: { id: 202, first_name: 'Client' },
    authDate: new Date('2026-11-14T00:00:00Z'),
  });
  chat.mockResolvedValue(false);
});

describe('authenticated chat activation route', () => {
  it('checks the verified Telegram actor, never the caller-supplied query ID', async () => {
    const response = await worker.fetch(new Request(
      'https://mezfit.test/api/telegram/chat-activation?userId=303',
      { headers: { 'x-telegram-init-data': 'signed' } },
    ), fixture());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ activated: false });
    expect(chat).toHaveBeenCalledWith('202', 'test-token');
  });

  it('rejects invalid Telegram auth without contacting the Bot API', async () => {
    identity.mockRejectedValueOnce(new TelegramAuthError('Invalid signature'));
    const response = await worker.fetch(new Request(
      'https://mezfit.test/api/telegram/chat-activation',
      { headers: { 'x-telegram-init-data': 'bad' } },
    ), fixture());
    expect(response.status).toBe(401);
    expect(chat).not.toHaveBeenCalled();
  });

  it('never treats Telegram transport failures as successful activation', async () => {
    chat.mockRejectedValueOnce(new Error('raw secret upstream error'));
    const response = await worker.fetch(new Request(
      'https://mezfit.test/api/telegram/chat-activation',
      { headers: { 'x-telegram-init-data': 'signed' } },
    ), fixture());
    expect(response.status).toBe(503);
    const payload = await response.json() as { error: { code: string; message: string } };
    expect(payload.error.code).toBe('TELEGRAM_CHAT_CHECK_UNAVAILABLE');
    expect(payload.error.message).not.toContain('raw secret');
  });
});
