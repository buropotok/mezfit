import { pathToFileURL } from 'node:url';

const endpoint = 'https://mezfit.buropotok.workers.dev/api/telegram/bot-webhook';
const requiredUpdates = ['message', 'callback_query'];

function safeDetail(description, { token, secret }) {
  if (typeof description !== 'string') return '';
  return description
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replaceAll(token, '[redacted]')
    .replaceAll(encodeURIComponent(token), '[redacted]')
    .replaceAll(secret, '[redacted]')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ')
    .replace(/::|##\[/g, ' ')
    .replace(/ +/g, ' ')
    .trim()
    .slice(0, 500);
}

function transportReason(error) {
  const code = error?.cause?.code ?? error?.code;
  if (error?.cause?.message === 'unexpected redirect') return 'REDIRECT_REJECTED';
  if (error?.name === 'TimeoutError' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT') return 'TIMEOUT';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'DNS_FAILURE';
  if (['CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT'].includes(code)) return 'TLS_FAILURE';
  if (['ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH'].includes(code)) return code;
  return 'REQUEST_FAILED';
}

async function apiRequest(fetchImpl, credentials, method, stage, payload) {
  let response;
  try {
    response = await fetchImpl('https://api.telegram.org/bot' + credentials.token + '/' + method, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new Error(stage + ': transport error (' + transportReason(error) + ')');
  }
  let body;
  try {
    body = await response.json();
  } catch (error) {
    const reason = error instanceof SyntaxError ? 'INVALID_JSON' : transportReason(error);
    throw new Error(stage + ': could not read response (HTTP ' + response.status + ', ' + reason + ')');
  }
  if (!response.ok || body?.ok !== true) {
    const detail = body?.ok === false ? safeDetail(body.description, credentials) : '';
    const code = Number.isSafeInteger(body?.error_code) && body.error_code !== response.status
      ? ', Bot API ' + body.error_code : '';
    const seconds = body?.parameters?.retry_after;
    const retry = Number.isSafeInteger(seconds) && seconds > 0 ? '; retry_after=' + seconds + 's' : '';
    throw new Error(stage + ': rejected or invalid response (HTTP ' + response.status + code + ')'
      + (detail ? ': ' + detail : '') + retry);
  }
  return body.result;
}

function webhookInfo(value, stage) {
  const invalid = field => { throw new Error(stage + ': invalid ' + field); };
  if (typeof value?.url !== 'string') invalid('url');
  if (typeof value.has_custom_certificate !== 'boolean') invalid('has_custom_certificate');
  if (!Number.isSafeInteger(value.pending_update_count) || value.pending_update_count < 0) invalid('pending_update_count');
  if (value.allowed_updates !== undefined && (!Array.isArray(value.allowed_updates)
      || value.allowed_updates.some(update => typeof update !== 'string'))) invalid('allowed_updates');
  if (value.max_connections !== undefined && (!Number.isInteger(value.max_connections)
      || value.max_connections < 1 || value.max_connections > 100)) invalid('max_connections');
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
  const credentials = { token, secret };

  const bot = await apiRequest(fetchImpl, credentials, 'getMe', 'getMe');
  if (bot?.username !== 'mezfit_bot' || bot.is_bot !== true) {
    throw new Error('getMe: TELEGRAM_BOT_TOKEN does not belong to @mezfit_bot');
  }
  const currentStage = 'getWebhookInfo before registration';
  const current = webhookInfo(await apiRequest(fetchImpl, credentials, 'getWebhookInfo', currentStage), currentStage);
  if (current.url && current.url !== endpoint) {
    throw new Error(currentStage + ': Telegram already has a different webhook');
  }
  if (current.has_custom_certificate) throw new Error(currentStage + ': Telegram already has a custom certificate');
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
  } catch (error) {
    throw new Error('Deployed Worker webhook: transport error (' + transportReason(error) + ')');
  }
  if (probe.status !== 200) {
    const reason = { 401: 'secret rejected', 403: 'access forbidden', 404: 'route not found',
      405: 'POST not allowed', 503: 'handler or credentials unavailable' }[probe.status] ?? 'unexpected response';
    throw new Error('Deployed Worker webhook: ' + reason + ' (HTTP ' + probe.status + ')');
  }

  const subscribed = current.allowed_updates ?? [];
  const updates = current.url && subscribed.length === 0
    ? undefined : [...new Set([...subscribed, ...requiredUpdates])];
  const requestedAt = Math.floor(Date.now() / 1000);
  const registered = await apiRequest(fetchImpl, credentials, 'setWebhook', 'setWebhook', {
    url: endpoint,
    secret_token: secret,
    allowed_updates: updates,
    max_connections: current.url ? current.max_connections : undefined,
    drop_pending_updates: false,
  });
  if (registered !== true) throw new Error('setWebhook: Telegram did not confirm registration');

  const readbackStage = 'getWebhookInfo after registration';
  const actual = webhookInfo(await apiRequest(fetchImpl, credentials, 'getWebhookInfo', readbackStage), readbackStage);
  const actualUpdates = actual.allowed_updates ?? [];
  if (actual.url !== endpoint) throw new Error(readbackStage + ': webhook URL does not match');
  if (actual.has_custom_certificate) throw new Error(readbackStage + ': unexpected custom certificate');
  if (updates ? !updates.every(update => actualUpdates.includes(update)) : actualUpdates.length !== 0) {
    throw new Error(readbackStage + ': allowed_updates does not match the requested subscriptions');
  }
  const deliveryErrorAt = Number.isSafeInteger(actual.last_error_date) && actual.last_error_date > 0
    ? actual.last_error_date : null;
  return { pendingUpdates: actual.pending_update_count, deliveryErrorAt,
    deliveryErrorIsRecent: deliveryErrorAt !== null && deliveryErrorAt >= requestedAt,
    deliveryError: deliveryErrorAt === null ? '' : safeDetail(actual.last_error_message, credentials) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const delivery = await configureTelegramWebhook(process.argv[2], process.env);
    if (!delivery) {
      console.log('Telegram webhook preflight passed (bot and existing destination verified)');
    } else {
      console.log('Telegram webhook registration verified; pending updates: ' + delivery.pendingUpdates);
      if (delivery.deliveryErrorAt !== null) {
        console.log('Telegram delivery error (' + (delivery.deliveryErrorIsRecent ? 'recent' : 'historical')
          + ', unix=' + delivery.deliveryErrorAt + '): ' + (delivery.deliveryError || 'no description supplied'));
      }
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
