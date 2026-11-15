'use strict';

// Private logger uses a restricted logs/ prefix in the existing media bucket.
// Existing public reads apply only to mvp-media/*; logs/ must remain private.
// Yandex PATCH requires bucket versioning to be DISABLED:
// https://yandex.cloud/en/docs/storage/s3/api-ref/object/patch
const { createHash, createHmac, randomUUID } = require('node:crypto');

const HOST = 'storage.yandexcloud.net';
const BUCKET = 'mezfit-comm-poc-20261106';
const LOG_PREFIX = 'logs/';
const LIMIT_BYTES = 1024 * 1024;
const MAX_ATTEMPTS = 8;
const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
});

function fileDate(date) {
  const parts = Object.fromEntries(DATE_FORMAT.formatToParts(date).map(({ type, value }) => [type, value]));
  return parts.year + parts.month + parts.day;
}

function fileName(date, sequence) {
  return LOG_PREFIX + 'logs_' + fileDate(date) + '_' + String(sequence).padStart(4, '0');
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key, value) {
  return createHmac('sha256', key).update(value).digest();
}

function redactOrigin(value) {
  if (typeof value !== 'string' || value.length > 300) return null;
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && url.origin === value ? url.origin : null;
  } catch {
    return null;
  }
}

// A fixed set of fields; never serialize event bodies, headers, initData or exception messages.
const LOG_FIELDS = new Set([
  'method', 'origin', 'reason', 'httpStatus', 'durationMs', 'contentType',
  'sizeBytes', 'storageKeyHash', 'stage', 'errorName', 'isBase64Encoded',
  'bodyLength', 'signatureExpiresAt',
]);
function createRecorder(clock = () => new Date()) {
  const requestId = randomUUID();
  const events = [];
  let tgId = null;
  function record(event, level = 'INFO', details = {}) {
    if (event === 'TELEGRAM_AUTH_VALID' && typeof details.tgId === 'string' && /^[1-9]\d*$/.test(details.tgId)) {
      tgId = details.tgId;
    }
    const safe = {};
    for (const [name, value] of Object.entries(details)) {
      if (!LOG_FIELDS.has(name) || value === undefined) continue;
      if (name === 'origin') { safe.origin = redactOrigin(value); continue; }
      if (typeof value === 'number' && Number.isFinite(value)) safe[name] = value;
      else if (typeof value === 'boolean') safe[name] = value;
      else if (typeof value === 'string' && value.length <= 120 && /^[\x20-\x7e]*$/.test(value)) {
        safe[name] = value;
      }
    }
    events.push({
      timestamp: clock().toISOString(), requestId, tgId,
      level: ['INFO', 'WARN', 'ERROR'].includes(level) ? level : 'INFO',
      event, ...safe,
    });
  }
  return { requestId, events, record };
}

function configured(env) {
  return !!(env.MEDIA_LOG_S3_ACCESS_KEY_ID && env.MEDIA_LOG_S3_SECRET_ACCESS_KEY);
}

function assertConfig(env) {
  if (typeof env.MEDIA_LOG_S3_ACCESS_KEY_ID !== 'string' || !/^[A-Za-z0-9_-]+$/.test(env.MEDIA_LOG_S3_ACCESS_KEY_ID)
    || typeof env.MEDIA_LOG_S3_SECRET_ACCESS_KEY !== 'string' || !env.MEDIA_LOG_S3_SECRET_ACCESS_KEY) {
    throw new Error('LOG_CONFIG_INVALID');
  }
}

function encode(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, symbol => '%' + symbol.charCodeAt(0).toString(16).toUpperCase());
}

// AWS Signature V4 for the four required operations: LIST, HEAD, PUT, PATCH.
// All object names are generated internally; credentials remain only on the server.
async function request(env, method, key, { query = {}, headers = {}, body, fetchImpl, signal, now = new Date() } = {}) {
  if (key && !key.startsWith(LOG_PREFIX)) throw new Error('LOG_KEY_OUTSIDE_PREFIX');
  const uri = '/' + BUCKET + (key ? '/' + key : '');
  const queryString = Object.entries(query).sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => encode(name) + '=' + encode(value)).join('&');
  const bodyHash = hash(body ?? '');
  const timestamp = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = timestamp.slice(0, 8);
  const scope = day + '/ru-central1/s3/aws4_request';
  const signed = {
    ...headers, host: HOST, 'x-amz-content-sha256': bodyHash, 'x-amz-date': timestamp,
  };
  const signedNames = Object.keys(signed).sort();
  const canonicalHeaders = signedNames.map(name => name + ':' + String(signed[name]).trim() + '\n').join('');
  const canonical = [method, uri, queryString, canonicalHeaders, signedNames.join(';'), bodyHash].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', timestamp, scope, hash(canonical)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac('AWS4' + env.MEDIA_LOG_S3_SECRET_ACCESS_KEY, day), 'ru-central1'), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const authorization = 'AWS4-HMAC-SHA256 Credential=' + env.MEDIA_LOG_S3_ACCESS_KEY_ID + '/' + scope
    + ', SignedHeaders=' + signedNames.join(';') + ', Signature=' + signature;
  const outgoing = { ...signed, authorization };
  delete outgoing.host; // Fetch supplies the same Host; keep it in the signature.
  return (fetchImpl ?? fetch)('https://' + HOST + uri + (queryString ? '?' + queryString : ''), {
    method, headers: outgoing, body, signal, redirect: 'error',
  });
}

function decodeXml(value) {
  return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function xmlValue(xml, tag) {
  const match = xml.match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>'));
  return match ? decodeXml(match[1]) : null;
}

async function lastFile(env, prefix, opts) {
  let continuationToken;
  let last = null;
  for (let page = 0; page < 100; page += 1) {
    const query = { 'list-type': '2', prefix, 'max-keys': '1000' };
    if (continuationToken) query['continuation-token'] = continuationToken;
    const response = await request(env, 'GET', '', { ...opts, query });
    if (!response.ok) throw new Error('LOG_LIST_HTTP_' + response.status);
    const xml = await response.text();
    if (!xml.includes('<ListBucketResult')) throw new Error('LOG_LIST_INVALID');
    for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const key = xmlValue(match[1], 'Key');
      const size = Number(xmlValue(match[1], 'Size'));
      const suffix = key?.slice(prefix.length);
      if (!key?.startsWith(prefix) || !/^\d{4,}$/.test(suffix) || !Number.isSafeInteger(size) || size < 0) continue;
      const sequence = Number(suffix);
      if (Number.isSafeInteger(sequence) && sequence > 0 && (!last || sequence > last.sequence)) {
        last = { key, size, sequence };
      }
    }
    if (xmlValue(xml, 'IsTruncated') !== 'true') return last;
    const next = xmlValue(xml, 'NextContinuationToken');
    if (!next || next === continuationToken) throw new Error('LOG_LIST_PAGINATION');
    continuationToken = next;
  }
  throw new Error('LOG_LIST_LIMIT');
}

function retryable(status) {
  return status === 409 || status === 412;
}

async function release(response) {
  try { await response.body?.cancel(); } catch { /* Disposing a response is best-effort. */ }
}

async function appendEvents(events, env, { fetchImpl, now = new Date(), timeoutMs = 1800 } = {}) {
  if (!events.length) return null;
  assertConfig(env);
  const data = Buffer.from(events.map(event => JSON.stringify(event)).join('\n') + '\n', 'utf8');
  if (data.length > LIMIT_BYTES) throw new Error('LOG_ENTRY_TOO_LARGE');
  const prefix = LOG_PREFIX + 'logs_' + fileDate(now) + '_';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const opts = { fetchImpl, signal: controller.signal };
  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const last = await lastFile(env, prefix, opts);
      const create = !last || last.size > LIMIT_BYTES;
      const key = create ? fileName(now, (last?.sequence ?? 0) + 1) : last.key;
      if (create) {
        const response = await request(env, 'PUT', key, {
          ...opts, body: data,
          headers: { 'content-type': 'application/x-ndjson', 'content-length': String(data.length), 'if-none-match': '*' },
        });
        await release(response);
        if (response.ok) return key;
        if (retryable(response.status)) continue;
        throw new Error('LOG_CREATE_HTTP_' + response.status);
      }
      const head = await request(env, 'HEAD', key, opts);
      if (head.status === 404 || retryable(head.status)) continue;
      if (!head.ok) throw new Error('LOG_HEAD_HTTP_' + head.status);
      const length = Number(head.headers.get('content-length'));
      const etag = head.headers.get('etag');
      if (!Number.isSafeInteger(length) || length < 0 || !etag || !/^"[^"\r\n]+"$/.test(etag)) {
        throw new Error('LOG_HEAD_INVALID');
      }
      if (length > LIMIT_BYTES) continue; // The next LIST will select a new sequence.
      const response = await request(env, 'PATCH', key, {
        ...opts, body: data,
        headers: {
          'content-type': 'application/x-ndjson', 'content-length': String(data.length),
          'content-range': 'bytes ' + length + '-' + (length + data.length - 1) + '/*',
          'if-match': etag,
        },
      });
      await release(response);
      if (response.ok) return key;
      if (retryable(response.status)) continue;
      throw new Error('LOG_PATCH_HTTP_' + response.status);
    }
    throw new Error('LOG_CONCURRENT_RETRY_EXHAUSTED');
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { createRecorder, configured, appendEvents, fileDate, fileName, LIMIT_BYTES };
