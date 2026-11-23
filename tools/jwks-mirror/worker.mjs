/**
 * Isolated Cloudflare Cron -> Telegram JWKS -> private Yandex Object Storage.
 * No browser endpoint, no auth token processing and no application API.
 */
const SOURCE = 'https://oauth.telegram.org/.well-known/jwks.json';
const STORAGE_ORIGIN = 'https://storage.yandexcloud.net';
const REGION = 'ru-central1';
const MAX_BYTES = 64 * 1024;
const encoder = new TextEncoder();

function hex(bytes) {
  return Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
}
async function sha256(data) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
}
async function hmac(key, message) {
  const imported = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, encoder.encode(message)));
}

/** Sign only two fixed keys in one isolated Yandex bucket. No arbitrary S3 proxy. */
async function s3Request(env, method, name, payload) {
  if (!/^[a-z0-9]{3,63}$/.test(env.YC_JWKS_BUCKET || '') ||
      !/^mezfit-telegram-jwks-[a-z0-9]+$/.test(env.YC_JWKS_BUCKET) ||
      !/^[A-Za-z0-9]+$/.test(env.YC_JWKS_ACCESS_KEY_ID || '') ||
      !env.YC_JWKS_SECRET_ACCESS_KEY ||
      !['jwks.json', 'status.json'].includes(name) ||
      !['GET', 'PUT'].includes(method)) throw new Error('CONFIG_INVALID');

  const url = new URL(STORAGE_ORIGIN + '/' + env.YC_JWKS_BUCKET + '/' + name);
  const body = method === 'PUT' ? encoder.encode(payload) : undefined;
  const checksum = await sha256(body ?? new Uint8Array());
  const now = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
  const day = now.slice(0, 8);
  const headers = {
    host: url.host,
    'x-amz-content-sha256': checksum,
    'x-amz-date': now,
  };
  if (method === 'PUT') headers['content-type'] = 'application/json';
  const signedNames = Object.keys(headers).sort();
  const canonical = signedNames.map(n => n + ':' + headers[n].trim() + '\n').join('');
  const scope = day + '/' + REGION + '/s3/aws4_request';
  const canonicalRequest = [method, url.pathname, '', canonical, signedNames.join(';'), checksum].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', now, scope,
    await sha256(encoder.encode(canonicalRequest))].join('\n');
  const kDate = await hmac(encoder.encode('AWS4' + env.YC_JWKS_SECRET_ACCESS_KEY), day);
  const kRegion = await hmac(kDate, REGION);
  const kService = await hmac(kRegion, 's3');
  const kSigning = await hmac(kService, 'aws4_request');
  const signature = hex(await hmac(kSigning, toSign));
  const requestHeaders = {
    ...headers,
    Authorization: 'AWS4-HMAC-SHA256 Credential=' + env.YC_JWKS_ACCESS_KEY_ID + '/' + scope +
      ', SignedHeaders=' + signedNames.join(';') + ', Signature=' + signature,
  };
  return fetch(url, {
    method, headers: requestHeaders, body, redirect: 'error',
    signal: AbortSignal.timeout(8000), cache: 'no-store',
  });
}

function normalizeJwks(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !Array.isArray(value.keys) || value.keys.length < 1 || value.keys.length > 16) {
    throw new Error('JWKS_INVALID');
  }
  const seen = new Set();
  const keys = value.keys.map(key => {
    if (!key || typeof key !== 'object' || Array.isArray(key) ||
        key.kty !== 'RSA' || (key.alg !== undefined && key.alg !== 'RS256') ||
        (key.use !== undefined && key.use !== 'sig') ||
        typeof key.kid !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(key.kid) ||
        typeof key.n !== 'string' || !/^[A-Za-z0-9_-]{250,1400}$/.test(key.n) ||
        typeof key.e !== 'string' || !/^[A-Za-z0-9_-]{2,12}$/.test(key.e) ||
        seen.has(key.kid)) throw new Error('JWKS_INVALID');
    seen.add(key.kid);
    return { kty: 'RSA', kid: key.kid, alg: 'RS256', use: 'sig', n: key.n, e: key.e };
  });
  keys.sort((a, b) => a.kid.localeCompare(b.kid));
  return { keys };
}

async function smallJson(response, missingAllowed = false) {
  if (missingAllowed && response.status === 404) return null;
  if (!response.ok) throw new Error('FETCH_HTTP_' + response.status);
  if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) throw new Error('RESPONSE_TOO_LARGE');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('RESPONSE_INVALID_JSON');
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) throw new Error('RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('RESPONSE_INVALID_JSON'); }
}

async function refresh(env) {
  let source;
  try {
    source = await fetch(SOURCE, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8000) });
  } catch {
    throw new Error('TELEGRAM_FETCH_FAILED');
  }
  const next = normalizeJwks(await smallJson(source));
  const currentRaw = await smallJson(await s3Request(env, 'GET', 'jwks.json'), true);
  // Malformed existing data must not be silently accepted as a valid baseline.
  const current = currentRaw === null ? null : normalizeJwks(currentRaw);
  const changed = !current || JSON.stringify(current) !== JSON.stringify(next);
  const currentStatus = await smallJson(await s3Request(env, 'GET', 'status.json'), true);
  const now = new Date().toISOString();
  if (changed) {
    const response = await s3Request(env, 'PUT', 'jwks.json', JSON.stringify(next));
    if (!response.ok) throw new Error('JWKS_WRITE_HTTP_' + response.status);
  }
  const status = {
    source: 'https://oauth.telegram.org/.well-known/jwks.json',
    checkedAt: now,
    changedAt: changed ? now : (
      currentStatus && typeof currentStatus.changedAt === 'string'
        ? currentStatus.changedAt : now
    ),
    kids: next.keys.map(key => key.kid),
    jwksSha256: await sha256(encoder.encode(JSON.stringify(next))),
  };
  const heartbeat = await s3Request(env, 'PUT', 'status.json', JSON.stringify(status));
  if (!heartbeat.ok) throw new Error('STATUS_WRITE_HTTP_' + heartbeat.status);
  console.log(JSON.stringify({ event: 'jwks_mirror_ok', changed, keyCount: next.keys.length }));
  return { changed, keyCount: next.keys.length };
}

export default {
  scheduled(_event, env, context) {
    context.waitUntil(refresh(env).catch(error => {
      const code = /^([A-Z_]+|FETCH_HTTP_\d+|JWKS_WRITE_HTTP_\d+|STATUS_WRITE_HTTP_\d+)$/.test(error?.message || '')
        ? error.message : 'MIRROR_FAILED';
      console.error(JSON.stringify({ event: 'jwks_mirror_failed', code }));
      throw error;
    }));
  },
  fetch() {
    return new Response('Not Found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  },
};
export { normalizeJwks, refresh };
