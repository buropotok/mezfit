import { pathToFileURL } from 'node:url';

const endpoint = 'https://mezfit.buropotok.workers.dev/api/telegram/bot-webhook';
const requiredUpdates = ['message', 'callback_query'];

async function apiRequest(fetchImpl, token, method, payload) {
  let response;
  try {
    response = await fetchImpl('https://api.telegram.org/bot' + token + '/' + method, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error(method + ': request failed or timed out');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ok !== true) {
    throw new Error(method + ': rejected or invalid response (HTTP ' + response.status + ')');
  }
  return body.result;
}

function webhookInfo(value) {
  if (typeof value?.url !== 'string' || typeof value.has_custom_certificate !== 'boolean'
      || !Number.isSafeInteger(value.pending_update_count) || value.pending_update_count < 0
      || (value.allowed_updates !== undefined && (!Array.isArray(value.allowed_updates)
        || value.allowed_updates.some(update => typeof update !== 'string')))
      || (value.max_connections !== undefined && (!Number.isInteger(value.max_connections)
        || value.max_connections < 1 || value.max_connections > 100))) {
    throw new Error('getWebhookInfo: unexpected response format');
  }
  return value;
}

export async function configureTelegramWebhook(action, env, fetchImpl = fetch) {
  const { TELEGRAM_BOT_TOKEN: token = '', TELEGRAM_BOT_WEBHOOK_SECRET: secret = '' } = env;
  if (!/^[0-9]+:[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error('Missing or invalid GitHub secret TELEGRAM_BOT_TOKEN');
  }
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
    throw new Error('Missing or invalid GitHub secret TELEGRAM_BOT_WEBHOOK_SECRET');
  }
  if (action !== 'preflight' && action !== 'register') throw new Error('Unknown Telegram webhook action');

  const bot = await apiRequest(fetchImpl, token, 'getMe');
  if (bot?.username !== 'mezfit_bot' || bot.is_bot !== true) {
    throw new Error('TELEGRAM_BOT_TOKEN does not belong to @mezfit_bot');
  }
  const current = webhookInfo(await apiRequest(fetchImpl, token, 'getWebhookInfo'));
  if ((current.url && current.url !== endpoint) || current.has_custom_certificate) {
    throw new Error('Telegram already has a different webhook or a custom certificate');
  }
  if (action === 'preflight') return;

  let probe;
  try {
    probe = await fetchImpl(endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: {
        'content-type': 'application/json',
        'x-telegram-bot-api-secret-token': secret,
      },
      // An authenticated update with no message or callback has no side effects.
      body: JSON.stringify({ update_id: 1 }),
    });
  } catch {
    throw new Error('Deployed Worker webhook: request failed or timed out');
  }
  if (probe.status !== 200) {
    throw new Error('Deployed Worker webhook did not accept the configured secret (HTTP ' + probe.status + ')');
  }

  const subscribed = current.allowed_updates ?? [];
  const updates = current.url && subscribed.length === 0
    ? undefined : [...new Set([...subscribed, ...requiredUpdates])];
  const registered = await apiRequest(fetchImpl, token, 'setWebhook', {
    url: endpoint,
    secret_token: secret,
    allowed_updates: updates,
    max_connections: current.url ? current.max_connections : undefined,
    drop_pending_updates: false,
  });
  if (registered !== true) throw new Error('setWebhook: Telegram did not confirm registration');

  const actual = webhookInfo(await apiRequest(fetchImpl, token, 'getWebhookInfo'));
  const actualUpdates = actual.allowed_updates ?? [];
  if (actual.url !== endpoint || actual.has_custom_certificate
      || (updates ? !updates.every(update => actualUpdates.includes(update)) : actualUpdates.length !== 0)) {
    throw new Error('getWebhookInfo: registered webhook does not match the requested configuration');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await configureTelegramWebhook(process.argv[2], process.env);
    console.log('Telegram webhook ' + (process.argv[2] === 'register' ? 'registered and verified' : 'preflight passed'));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
