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

  it('reports why Telegram rejected registration without leaking credentials or injecting log lines', async () => {
    const successfulResponse = fixture();
    const request = vi.fn(async (url, init) => {
      if (!url.endsWith('/setWebhook')) return successfulResponse(url, init);
      return Response.json({
        ok: false,
        error_code: 400,
        description: 'Bad Request: bad webhook: Failed to resolve host\n::warning:: '
          + env.TELEGRAM_BOT_TOKEN + ' ' + env.TELEGRAM_BOT_WEBHOOK_SECRET,
      }, { status: 400 });
    });
    await expect(configureTelegramWebhook('register', env, request)).rejects.toThrow(
      'setWebhook: rejected or invalid response (HTTP 400): Bad Request: bad webhook: Failed to resolve host warning [redacted] [redacted]',
    );
    expect(targets(request)).toEqual(['getMe', 'getWebhookInfo', 'Worker', 'setWebhook']);
  });

  it('separates an unreachable Telegram API from a non-JSON gateway response', async () => {
    const dnsFailure = new TypeError('request with ' + env.TELEGRAM_BOT_TOKEN, {
      cause: { code: 'ENOTFOUND' },
    });
    await expect(configureTelegramWebhook('preflight', env, async () => { throw dnsFailure; }))
      .rejects.toThrow('getMe: transport error (DNS_FAILURE)');
    await expect(configureTelegramWebhook('preflight', env, async () => new Response('<html>', { status: 502 })))
      .rejects.toThrow('getMe: could not read response (HTTP 502, INVALID_JSON)');
  });

  it('reports Telegram subscription checks and delivery status separately', async () => {
    const response = fixture();
    let reads = 0;
    const request = async (url, init) => {
      if (url.endsWith('/getWebhookInfo') && ++reads === 2) {
        return Response.json({ ok: true, result: {
          url: endpoint,
          has_custom_certificate: false,
          pending_update_count: 3,
          allowed_updates: ['message', 'callback_query'],
          last_error_date: 1,
          last_error_message: 'Wrong response from the webhook: 401 ' + env.TELEGRAM_BOT_WEBHOOK_SECRET,
        } });
      }
      return response(url, init);
    };
    await expect(configureTelegramWebhook('register', env, request)).resolves.toEqual({
      pendingUpdates: 3, deliveryErrorAt: 1, deliveryErrorIsRecent: false,
      deliveryError: 'Wrong response from the webhook: 401 [redacted]',
    });
    await expect(configureTelegramWebhook('register', env, fixture({ actualUpdates: ['message'] })))
      .rejects.toThrow('getWebhookInfo after registration: allowed_updates does not match');
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
