import { validatedTelegramId } from '../../shared/approved-relationship';
import { discussionRecord as record } from '../../shared/discussion-anchor';
import { notificationStartParam, type TelegramNotificationTarget } from '../../shared/telegram-notification-link';

export interface CoachTelegramEnv {
  DB_BINDING: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_BOT_USERNAME: string;
}

export type TelegramDelivery = {
  status: 'sent' | 'blocked' | 'retry';
  messageId: number | null;
  waitSeconds: number;
};

interface TelegramNotification {
  coachUserId: string;
  client?: { userId: string; name: string };
  title: string;
  context?: string;
  button: string;
  target: TelegramNotificationTarget;
}

const retry = (waitSeconds = 60): TelegramDelivery => ({ status: 'retry', messageId: null, waitSeconds });
const blocked: TelegramDelivery = { status: 'blocked', messageId: null, waitSeconds: 0 };
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;');

async function telegram(env: CoachTelegramEnv, method: string, payload: object, fetchImpl: typeof fetch) {
  try {
    const response = await fetchImpl('https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/' + method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    const body: unknown = await response.json();
    const result = response.ok && record(body) && body.ok === true ? body.result : undefined;
    const after = record(body) && record(body.parameters) ? body.parameters.retry_after : undefined;
    return {
      result, status: response.status,
      description: record(body) && typeof body.description === 'string' ? body.description : '',
      wait: typeof after === 'number' && Number.isFinite(after) && after > 0 ? after : 60,
    };
  } catch {
    return { result: undefined, status: 503, description: '', wait: 60 };
  }
}

const missingTopic = (response: Awaited<ReturnType<typeof telegram>>) =>
  response.status === 400 && /message thread not found|topic_deleted/i.test(response.description);

async function resolveTopic(env: CoachTelegramEnv, chatId: string, key: string, name: string,
  fetchImpl: typeof fetch): Promise<{ threadId: number } | { delivery: TelegramDelivery }> {
  const row = await env.DB_BINDING.prepare(
    'SELECT telegram_thread_id, topic_title FROM telegram_coach_topics WHERE coach_user_id = ? AND topic_key = ?',
  ).bind(chatId, key).first<{ telegram_thread_id: number | null; topic_title: string | null }>();
  if (row?.telegram_thread_id) {
    if (row.topic_title !== name) {
      const result = await telegram(env, 'editForumTopic',
        { chat_id: chatId, message_thread_id: row.telegram_thread_id, name }, fetchImpl);
      if (result.result === true) await env.DB_BINDING.prepare(
        'UPDATE telegram_coach_topics SET topic_title = ? WHERE coach_user_id = ? AND topic_key = ? AND telegram_thread_id = ?',
      ).bind(name, chatId, key, row.telegram_thread_id).run();
    }
    return { threadId: row.telegram_thread_id };
  }
  const now = Date.now();
  const lease = now + 30_000;
  const claim = await env.DB_BINDING.prepare(`
    INSERT INTO telegram_coach_topics (coach_user_id, topic_key, claim_until) VALUES (?, ?, ?)
    ON CONFLICT (coach_user_id, topic_key) DO UPDATE SET claim_until = excluded.claim_until
    WHERE telegram_thread_id IS NULL AND claim_until <= ?
  `).bind(chatId, key, lease, now).run();
  if (claim.meta.changes !== 1) return { delivery: retry() };
  const response = await telegram(env, 'createForumTopic', { chat_id: chatId, name }, fetchImpl);
  const threadId = record(response.result) ? response.result.message_thread_id : null;
  if (typeof threadId !== 'number' || !Number.isSafeInteger(threadId) || threadId <= 0) {
    return { delivery: response.status === 403 || /chat not found/i.test(response.description) ? blocked : retry(response.wait) };
  }
  await env.DB_BINDING.prepare(`
    UPDATE telegram_coach_topics SET telegram_thread_id = ?, topic_title = ?, claim_until = 0
    WHERE coach_user_id = ? AND topic_key = ? AND claim_until = ?
  `).bind(threadId, name, chatId, key, lease).run();
  return { threadId };
}

export async function sendCoachTelegram(
  env: CoachTelegramEnv, notification: TelegramNotification, fetchImpl: typeof fetch = fetch,
): Promise<TelegramDelivery> {
  const chatId = validatedTelegramId(notification.coachUserId);
  if (!chatId || !/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(env.TELEGRAM_BOT_USERNAME)) return blocked;
  const key = notification.client?.userId ?? 'general';
  const name = Array.from(notification.client?.name.trim() || (notification.client ? 'Клиент' : 'Общее')).slice(0, 128).join('');
  const url = 'https://t.me/' + env.TELEGRAM_BOT_USERNAME + '?startapp=' + notificationStartParam(notification.target);
  const topic = await resolveTopic(env, chatId, key, name, fetchImpl);
  if ('delivery' in topic) return topic.delivery;
  const rich = '<p><b>' + escape(notification.title) + '</b></p>'
    + (notification.context ? '<p>' + escape(notification.context) + '</p>' : '')
    + '<tg-button-row><tg-button type="url" url="' + escape(url) + '">'
    + escape(notification.button) + '</tg-button></tg-button-row>';
  const response = await telegram(env, 'sendRichMessage', {
    chat_id: chatId, message_thread_id: topic.threadId, rich_message: { html: rich },
  }, fetchImpl);
  const messageId = record(response.result) ? response.result.message_id : null;
  if (typeof messageId === 'number' && Number.isSafeInteger(messageId) && messageId > 0) {
    return { status: 'sent', messageId, waitSeconds: 0 };
  }
  if (missingTopic(response)) {
    await env.DB_BINDING.prepare(`
      UPDATE telegram_coach_topics SET telegram_thread_id = NULL, claim_until = 0
      WHERE coach_user_id = ? AND topic_key = ? AND telegram_thread_id = ?
    `).bind(chatId, key, topic.threadId).run();
    return retry();
  }
  return response.status === 403 || /chat not found/i.test(response.description) ? blocked : retry(response.wait);
}
