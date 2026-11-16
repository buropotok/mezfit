import { describe, expect, it } from 'vitest';
import { sendTopicTelegram } from './coach-telegram';

async function notificationHtml(messageText?: string): Promise<string> {
  let html = '';
  const db = {
    prepare: () => ({
      bind: () => ({
        first: async () => ({ telegram_thread_id: 7, topic_title: 'Алексей' }),
        run: async () => ({ meta: { changes: 1 } }),
      }),
    }),
  } as unknown as D1Database;
  const fetchImpl: typeof fetch = async (_url, init) => {
    const payload: unknown = JSON.parse(String(init?.body));
    if (payload && typeof payload === 'object' && 'rich_message' in payload) {
      const rich = payload.rich_message;
      if (rich && typeof rich === 'object' && 'html' in rich && typeof rich.html === 'string') {
        html = rich.html;
      }
    }
    return Response.json({ ok: true, result: { message_id: 42 } });
  };
  const result = await sendTopicTelegram({
    DB_BINDING: db, TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_BOT_USERNAME: 'mezfit_bot',
  }, {
    recipientUserId: 'tg:1',
    peer: { userId: 'tg:2', name: 'Алексей' },
    title: 'Новое сообщение в обсуждении',
    context: 'Программа «Набор массы»',
    messageText,
    button: 'Открыть обсуждение',
    target: { kind: 'discussion', id: 'message-1' },
  }, fetchImpl);
  expect(result.status).toBe('sent');
  return html;
}

describe('Telegram discussion message notification', () => {
  it('adds escaped message text after the entity name, keeping existing labels and button', async () => {
    const html = await notificationHtml('<b>Важно & срочно</b>');
    expect(html).toContain('<p><b>Новое сообщение в обсуждении</b></p>'
      + '<p>Программа «Набор массы»</p>'
      + '<p>&lt;b&gt;Важно &amp; срочно&lt;/b&gt;</p>'
      + '<tg-button-row>');
    expect(html).toContain('Открыть обсуждение</tg-button>');
  });

  it('limits the preview to 200 Unicode characters without splitting emoji', async () => {
    const html = await notificationHtml('а'.repeat(199) + '😀' + 'лишнее');
    expect(html).toContain('<p>' + 'а'.repeat(199) + '😀</p><tg-button-row>');
    expect(html).not.toContain('лишнее');
  });

  it('keeps notifications without text unchanged', async () => {
    const html = await notificationHtml();
    expect(html).toContain('<p>Программа «Набор массы»</p><tg-button-row>');
  });
});
