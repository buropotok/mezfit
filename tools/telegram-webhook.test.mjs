import { describe, expect, it, vi } from 'vitest';
import { configureTelegramWebhook } from './telegram-webhook.mjs';

const endpoint = 'https://mezfit.buropotok.workers.dev/api/telegram/bot-webhook';
const env = { TELEGRAM_BOT_TOKEN: '123:fixture', TELEGRAM_BOT_WEBHOOK_SECRET: 'fixture_secret' };

function fixture({ current = '', accepted = endpoint, probe = 200,
  existingUpdates, actualUpdates = ['message', 'callback_query'], username = 'mezfit_bot' } = {}) {
  const ok = result => Response.json({ ok: true, result });
  const hook = (url, allowed_updates) => ({ url, has_custom_certificate: false, pending_update_count: 0, allowed_updates });
  let registrations = 0;
  return vi.fn(async (url, init) => {
    if (url === endpoint) return new Response(null, { status: probe });
    const method = new URL(url).pathname.split('/').at(-1);
    if (method === 'getMe') return ok({ is_bot: true, username });
    if (method === 'getWebhookInfo') {
      return ok(registrations === 0 ? hook(current, existingUpdates) : hook(accepted, actualUpdates));
    }
    if (method === 'setWebhook') {
      registrations++;
      expect(JSON.parse(init.body)).toMatchObject({
        url: endpoint, secret_token: env.TELEGRAM_BOT_WEBHOOK_SECRET, drop_pending_updates: false,
      });
      return ok(true);
    }
    throw new Error('Unexpected request');
  });
}

const targets = request => request.mock.calls.map(([url]) => url === endpoint ? 'Worker' : url.split('/').at(-1));

describe('Telegram webhook deployment', () => {
  it('registers only after verifying the bot, existing webhook and deployed secret', async () => {
    const request = fixture();
    await configureTelegramWebhook('register', env, request);
    expect(targets(request)).toEqual(['getMe', 'getWebhookInfo', 'Worker', 'setWebhook', 'getWebhookInfo']);
    expect(request.mock.calls[2][1].headers['x-telegram-bot-api-secret-token']).toBe(env.TELEGRAM_BOT_WEBHOOK_SECRET);
  });

  it('keeps extra subscriptions when reconnecting the same webhook', async () => {
    const request = fixture({
      current: endpoint, existingUpdates: ['inline_query'],
      actualUpdates: ['inline_query', 'message', 'callback_query'],
    });
    await configureTelegramWebhook('register', env, request);
    expect(JSON.parse(request.mock.calls[3][1].body).allowed_updates)
      .toEqual(['inline_query', 'message', 'callback_query']);
  });

  it('preflights without changing Telegram or calling the Worker', async () => {
    const request = fixture();
    await configureTelegramWebhook('preflight', env, request);
    expect(targets(request)).toEqual(['getMe', 'getWebhookInfo']);
  });

  it.each([
    [{ username: 'other_bot' }, /does not belong/, ['getMe']],
    [{ current: 'https://other.example/webhook' }, /different webhook/, ['getMe', 'getWebhookInfo']],
    [{ probe: 401 }, /HTTP 401/, ['getMe', 'getWebhookInfo', 'Worker']],
    [{ actualUpdates: ['message'] }, /does not match/, ['getMe', 'getWebhookInfo', 'Worker', 'setWebhook', 'getWebhookInfo']],
  ])('reports configuration failures at the right stage', async (options, error, calls) => {
    const request = fixture(options);
    await expect(configureTelegramWebhook('register', env, request)).rejects.toThrow(error);
    expect(targets(request)).toEqual(calls);
  });
});
