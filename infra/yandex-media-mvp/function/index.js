'use strict';

const { createHash, createHmac, timingSafeEqual } = require('node:crypto');
const { createRecorder, configured: loggingConfigured, appendEvents } = require('./media-log');

const bucket = 'mezfit-comm-poc-20261106';
const host = 'storage.yandexcloud.net';
const expiresSeconds = 600;
const maxAuthAgeSeconds = 24 * 60 * 60;
const limits = new Map([
  ['image/jpeg', 20], ['image/png', 20], ['image/webp', 20], ['image/gif', 20], ['image/heic', 20],
  ['video/mp4', 250], ['video/webm', 250], ['video/quicktime', 250],
  ['audio/ogg', 25], ['audio/webm', 25], ['audio/mp4', 25], ['audio/mpeg', 25], ['audio/wav', 25],
]);

function hmac(key, value) {
  return createHmac('sha256', key).update(value).digest();
}

function telegramUserId(initData, botToken, now, onReject = () => {}) {
  const reject = reason => { onReject(reason); return null; };
  if (typeof initData !== 'string' || !initData) return reject('INITDATA_MISSING');
  if (initData.length > 8192) return reject('INITDATA_TOO_LARGE');
  const params = new URLSearchParams(initData);
  const seen = new Set();
  for (const [key, value] of params) {
    if (seen.has(key)) return reject('INITDATA_DUPLICATE_FIELD');
    if (!/^[a-z_][a-z0-9_]*$/.test(key) || /[\r\n]/.test(value)) return reject('INITDATA_INVALID_FIELD');
    seen.add(key);
  }

  const hash = params.get('hash');
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return reject('INITDATA_HASH_INVALID');
  params.delete('hash');
  params.sort();
  const data = [...params].map(([key, value]) => `${key}=${value}`).join('\n');
  if (!timingSafeEqual(Buffer.from(hash, 'hex'), hmac(hmac('WebAppData', botToken), data))) return reject('INITDATA_HASH_MISMATCH');

  const authDate = params.get('auth_date');
  if (!authDate || !/^\d{1,12}$/.test(authDate)) return reject('INITDATA_AUTH_DATE_INVALID');
  const age = Math.floor(now.getTime() / 1000) - Number(authDate);
  if (age < -60) return reject('INITDATA_AUTH_DATE_FUTURE');
  if (age > maxAuthAgeSeconds) return reject('INITDATA_AUTH_DATE_EXPIRED');

  try {
    const id = JSON.parse(params.get('user'))?.id;
    return Number.isSafeInteger(id) && id > 0 ? String(id) : reject('INITDATA_USER_INVALID');
  } catch {
    return reject('INITDATA_USER_JSON_INVALID');
  }
}

function presignPut({ storageKey, contentType, sizeBytes }, env, now) {
  const timestamp = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = timestamp.slice(0, 8);
  const scope = `${date}/ru-central1/s3/aws4_request`;
  const path = `/${bucket}/${storageKey}`;
  const headers = {
    'content-length': String(sizeBytes),
    'content-type': contentType,
    host,
    'if-none-match': '*',
  };
  const signedHeaders = Object.keys(headers).join(';');
  const query = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${env.MEDIA_S3_ACCESS_KEY_ID}/${scope}`,
    'X-Amz-Date': timestamp,
    'X-Amz-Expires': String(expiresSeconds),
    'X-Amz-SignedHeaders': signedHeaders,
  });
  const canonicalHeaders = Object.entries(headers).map(([name, value]) => `${name}:${value}\n`).join('');
  const canonical = ['PUT', path, query.toString(), canonicalHeaders, signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', timestamp, scope, createHash('sha256').update(canonical).digest('hex')].join('\n');
  const regionKey = hmac(hmac('AWS4' + env.MEDIA_S3_SECRET_ACCESS_KEY, date), 'ru-central1');
  const signingKey = hmac(hmac(regionKey, 's3'), 'aws4_request');
  query.set('X-Amz-Signature', hmac(signingKey, toSign).toString('hex'));
  return {
    storageKey,
    putUrl: `https://${host}${path}?${query}`,
    expiresAt: Math.floor(now.getTime() / 1000) * 1000 + expiresSeconds * 1000,
  };
}

function handleRequest(event, env, now, trace = () => {}) {
  const started = Date.now();
  const headers = Object.fromEntries(Object.entries(event.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
  const origins = (env.MEDIA_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  const cors = origins.includes(headers.origin) && headers.origin !== '*' && headers.origin !== 'null'
    ? { 'Access-Control-Allow-Origin': headers.origin } : {};
  trace('REQUEST_RECEIVED', 'INFO', {
    method: event.httpMethod, origin: headers.origin, bodyLength: typeof event.body === 'string' ? event.body.length : 0,
    isBase64Encoded: event.isBase64Encoded === true,
  });
  function respond(statusCode, payload) {
    trace('RESPONSE_CREATED', statusCode >= 500 ? 'ERROR' : statusCode >= 400 ? 'WARN' : 'INFO', {
      httpStatus: statusCode, reason: payload?.code ?? 'SUCCESS', durationMs: Date.now() - started,
    });
    return {
      statusCode,
      headers: { ...cors, Vary: 'Origin', 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
      body: payload ? JSON.stringify(payload) : '',
      isBase64Encoded: false,
    };
  }
  if (headers.origin && !cors['Access-Control-Allow-Origin']) {
    trace('ORIGIN_REJECTED', 'WARN', { reason: 'ORIGIN_NOT_ALLOWED' });
    return respond(403, { code: 'ORIGIN_DENIED' });
  }
  trace('ORIGIN_CHECKED', 'INFO', { reason: headers.origin ? 'ALLOWED' : 'NOT_PROVIDED' });
  if (event.httpMethod === 'OPTIONS') {
    trace('PREFLIGHT_HANDLED');
    const response = respond(204);
    return {
      ...response,
      headers: {
        ...response.headers,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '300',
      },
    };
  }
  if (event.httpMethod !== 'POST') {
    trace('METHOD_REJECTED', 'WARN', { method: event.httpMethod });
    return respond(405, { code: 'METHOD_NOT_ALLOWED' });
  }
  if (!env.TELEGRAM_BOT_TOKEN || !/^[A-Za-z0-9_-]+$/.test(env.MEDIA_S3_ACCESS_KEY_ID ?? '')
    || !env.MEDIA_S3_SECRET_ACCESS_KEY || !origins.length) {
    trace('SIGNER_CONFIG_INVALID', 'ERROR', { reason: 'MISSING_REQUIRED_CONFIG' });
    return respond(503, { code: 'NOT_CONFIGURED' });
  }
  trace('SIGNER_CONFIG_VALID');

  const raw = event.body;
  if (typeof raw !== 'string' || raw.length > 16384) {
    trace('REQUEST_BODY_REJECTED', 'WARN', { reason: typeof raw !== 'string' ? 'BODY_NOT_STRING' : 'BODY_TOO_LARGE' });
    return respond(400, { code: 'INVALID_REQUEST' });
  }
  let payload;
  try {
    payload = JSON.parse(event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw);
  } catch {
    trace('REQUEST_JSON_REJECTED', 'WARN', { reason: 'INVALID_JSON_OR_BASE64' });
    return respond(400, { code: 'INVALID_REQUEST' });
  }
  trace('REQUEST_JSON_PARSED');
  const userId = telegramUserId(payload?.initData, env.TELEGRAM_BOT_TOKEN, now,
    reason => trace('TELEGRAM_AUTH_REJECTED', 'WARN', { reason }));
  if (!userId) return respond(401, { code: 'TELEGRAM_AUTH_REQUIRED' });
  trace('TELEGRAM_AUTH_VALID', 'INFO', { tgId: userId });
  if (env.MEDIA_TELEGRAM_ALLOWLIST && !env.MEDIA_TELEGRAM_ALLOWLIST.split(',').some(id => id.trim() === userId)) {
    trace('ALLOWLIST_REJECTED', 'WARN', { reason: 'USER_NOT_ALLOWED' });
    return respond(403, { code: 'TELEGRAM_USER_DENIED' });
  }
  trace('ALLOWLIST_CHECKED', 'INFO', { reason: env.MEDIA_TELEGRAM_ALLOWLIST ? 'ALLOWED' : 'NOT_ENABLED' });

  const { storageKey, contentType, sizeBytes } = payload;
  const limit = limits.get(contentType);
  const invalidKey = typeof storageKey !== 'string' || storageKey.length !== 74
    || !/^mvp-media\/[a-f0-9]{64}$/.test(storageKey);
  const invalidSize = !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || (limit && sizeBytes > limit * 1024 * 1024);
  if (invalidKey || !limit || invalidSize) {
    trace('UPLOAD_VALIDATION_REJECTED', 'WARN', {
      reason: invalidKey ? 'INVALID_KEY' : !limit ? 'INVALID_CONTENT_TYPE' : 'INVALID_SIZE',
      contentType, sizeBytes,
    });
    return respond(400, { code: 'INVALID_UPLOAD' });
  }
  trace('UPLOAD_VALIDATED', 'INFO', {
    contentType, sizeBytes, storageKeyHash: createHash('sha256').update(storageKey).digest('hex'),
  });
  trace('SIGNATURE_STARTED');
  try {
    const signature = presignPut({ storageKey, contentType, sizeBytes }, env, now);
    trace('SIGNATURE_CREATED', 'INFO', { signatureExpiresAt: signature.expiresAt });
    return respond(200, signature);
  } catch (error) {
    trace('SIGNATURE_FAILED', 'ERROR', { stage: 'SIGNING', errorName: error?.name ?? 'Error' });
    throw error;
  }
}

exports.handleRequest = handleRequest;
exports.handler = async event => {
  const recorder = createRecorder();
  let response;
  try {
    response = handleRequest(event, process.env, new Date(), recorder.record);
  } catch (error) {
    recorder.record('UNHANDLED_EXCEPTION', 'ERROR', { stage: 'HANDLER', errorName: error?.name ?? 'Error' });
    const origin = event?.headers?.origin ?? event?.headers?.Origin;
    const origins = (process.env.MEDIA_ORIGINS ?? '').split(',').map(value => value.trim());
    const cors = origins.includes(origin) && origin !== '*' && origin !== 'null'
      ? { 'Access-Control-Allow-Origin': origin } : {};
    response = {
      statusCode: 500,
      headers: { ...cors, Vary: 'Origin', 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'INTERNAL_ERROR' }),
      isBase64Encoded: false,
    };
    recorder.record('RESPONSE_CREATED', 'ERROR', { httpStatus: 500, reason: 'INTERNAL_ERROR' });
  }
  try {
    if (loggingConfigured(process.env)) {
      await appendEvents(recorder.events, process.env);
    } else {
      console.error('[media-log] LOGGING_NOT_CONFIGURED');
    }
  } catch (error) {
    // Logging is strictly best-effort. Never fail signing because the log bucket is down.
    const code = /^LOG_[A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'LOG_WRITE_FAILED';
    console.error('[media-log] ' + code);
  }
  return response;
};
