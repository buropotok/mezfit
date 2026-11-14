import { describe, expect, it, vi } from 'vitest';
import { notificationStartParam, parseNotificationStartParam } from '../../shared/telegram-notification-link';
import { dismissTelegramNotification } from './coach-telegram';

describe('Telegram notification dismissal', () => {
  const receipt = 'a'.repeat(32);

  it('keeps the notification identity and destination in the same link', () => {
    const target = { kind: 'discussion', id: 'message-1', receipt } as const;
    expect(parseNotificationStartParam(notificationStartParam(target))).toEqual(target);
  });

  it('deletes only the recorded message in the recipient chat', async () => {
    const run = vi.fn(async () => ({}));
    const first = vi.fn(async (): Promise<{ message_id: number } | null> => ({ message_id: 17 }));
    const bind = vi.fn((..._args: unknown[]) => ({ first, run }));
    const prepare = vi.fn((_sql: string) => ({ bind }));
    const env = {
      DB_BINDING: { prepare } as unknown as D1Database,
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_BOT_USERNAME: 'mezfit_bot',
    };
    const fetchTelegram = vi.fn<typeof fetch>(async () => Response.json({ ok: true, result: true }));
    await dismissTelegramNotification(env, '123', receipt, fetchTelegram);
    expect(bind).toHaveBeenNthCalledWith(1, receipt, '123', expect.any(Number));
    expect(fetchTelegram).toHaveBeenCalledWith(expect.stringMatching(/\/deleteMessage$/),
      expect.objectContaining({ body: JSON.stringify({ chat_id: '123', message_id: 17 }) }));
    expect(bind).toHaveBeenNthCalledWith(2, receipt, '123');

    first.mockResolvedValueOnce(null);
    fetchTelegram.mockClear();
    await dismissTelegramNotification(env, '456', receipt, fetchTelegram);
    expect(fetchTelegram).not.toHaveBeenCalled();
  });
});
