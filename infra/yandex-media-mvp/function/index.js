'use strict';

const { createHash, createHmac, timingSafeEqual } = require('node:crypto');

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

function telegramUserId(initData, botToken, now) {
  if (typeof initData !== 'string' || !initData || initData.length > 8192) return null;
  const params = new URLSearchParams(initData);
  const seen = new Set();
  for (const [key, value] of params) {
    if (seen.has(key) || !/^[a-z_][a-z0-9_]*$/.test(key) || /[\r\n]/.test(value)) return null;
    seen.add(key);
  }

  const hash = params.get('hash');
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return null;
  params.delete('hash');
  params.sort();
  const data = [...params].map(([key, value]) => `${key}=${value}`).join('\n');
  if (!timingSafeEqual(Buffer.from(hash, 'hex'), hmac(hmac('WebAppData', botToken), data))) return null;

  const authDate = params.get('auth_date');
  if (!authDate || !/^\d{1,12}$/.test(authDate)) return null;
  const age = Math.floor(now.getTime() / 1000) - Number(authDate);
  if (age < -60 || age > maxAuthAgeSeconds) return null;

  try {
    const id = JSON.parse(params.get('user'))?.id;
    return Number.isSafeInteger(id) && id > 0 ? String(id) : null;
  } catch {
    return null;
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

function handleRequest(event, env, now) {
  const headers = Object.fromEntries(Object.entries(event.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
  const origins = (env.MEDIA_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  const cors = origins.includes(headers.origin) && headers.origin !== '*' && headers.origin !== 'null'
    ? { 'Access-Control-Allow-Origin': headers.origin } : {};
  function respond(statusCode, payload) {
    return {
      statusCode,
      headers: { ...cors, Vary: 'Origin', 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
      body: payload ? JSON.stringify(payload) : '',
      isBase64Encoded: false,
    };
  }
  if (headers.origin && !cors['Access-Control-Allow-Origin']) return respond(403, { code: 'ORIGIN_DENIED' });
  if (event.httpMethod === 'OPTIONS') {
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
  if (event.httpMethod !== 'POST') return respond(405, { code: 'METHOD_NOT_ALLOWED' });
  if (!env.TELEGRAM_BOT_TOKEN || !/^[A-Za-z0-9_-]+$/.test(env.MEDIA_S3_ACCESS_KEY_ID ?? '')
    || !env.MEDIA_S3_SECRET_ACCESS_KEY || !origins.length) return respond(503, { code: 'NOT_CONFIGURED' });

  const raw = event.body;
  if (typeof raw !== 'string' || raw.length > 16384) return respond(400, { code: 'INVALID_REQUEST' });
  let payload;
  try {
    payload = JSON.parse(event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw);
  } catch {
    return respond(400, { code: 'INVALID_REQUEST' });
  }
  const userId = telegramUserId(payload?.initData, env.TELEGRAM_BOT_TOKEN, now);
  if (!userId) return respond(401, { code: 'TELEGRAM_AUTH_REQUIRED' });
  if (env.MEDIA_TELEGRAM_ALLOWLIST && !env.MEDIA_TELEGRAM_ALLOWLIST.split(',').some(id => id.trim() === userId)) {
    return respond(403, { code: 'TELEGRAM_USER_DENIED' });
  }

  const { storageKey, contentType, sizeBytes } = payload;
  const limit = limits.get(contentType);
  if (typeof storageKey !== 'string' || storageKey.length !== 74 || !/^mvp-media\/[a-f0-9]{64}$/.test(storageKey)
    || !limit || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > limit * 1024 * 1024) {
    return respond(400, { code: 'INVALID_UPLOAD' });
  }

  return respond(200, presignPut({ storageKey, contentType, sizeBytes }, env, now));
}

exports.handleRequest = handleRequest;
exports.handler = async event => handleRequest(event, process.env, new Date());
