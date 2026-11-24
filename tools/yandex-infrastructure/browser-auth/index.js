'use strict';

/**
 * Browser-only Telegram OIDC bridge for Yandex Cloud Functions (Node.js 22).
 *
 * This is NOT a substitute for Telegram Mini App initData. A browser cookie
 * can verify browser identity for the session and Dexie token endpoints.
 * No bot token, OIDC secret or signing key is bundled with the source code.
 */
const {
  createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify,
} = require('node:crypto');

const ISSUER = 'https://oauth.telegram.org';
const COOKIE_FLOW = '__Host-mz_oidc_flow';
const COOKIE_POPUP = '__Host-mz_oidc_popup';
const COOKIE_SESSION = '__Host-mz_browser_session';
const DEXIE_TOKEN_PATH = '/api/dexie-cloud/tokens';
const MAX_DEVICE_KEY_LENGTH = 8192;
const FLOW_TTL = 600;
const LEGACY_SESSION_TTL = 12 * 60 * 60;
const SESSION_RENEW_INTERVAL = 24 * 60 * 60;
const SESSION_TTL = 400 * SESSION_RENEW_INTERVAL;
const MAX_JWT_LENGTH = 12000;
const POPUP_TTL = 300;
const JWKS_TTL = 300_000;
const MIRROR_REFRESH = 60_000;
const JWKS_SOURCE = ISSUER + '/.well-known/jwks.json';
let popupKeys;
let popupKeysRequest;
let mirrorKeys;
let mirrorKeysRequest;
const NO_CACHE = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};
const base64url = (buffer) => Buffer.from(buffer).toString('base64url');
const epoch = () => Math.floor(Date.now() / 1000);

function sessionConfiguration() {
  const sessionSecret = process.env.MEZFIT_BROWSER_SESSION_SECRET || '';
  const hosts = (process.env.MEZFIT_AUTH_HOSTS || '').split(',').map(x => x.trim());
  if (!/^[A-Za-z0-9_-]{43,}$/.test(sessionSecret)
      || Buffer.from(sessionSecret, 'base64url').length < 32
      || hosts.length === 0 || hosts.some(host => !/^[a-z0-9][a-z0-9.-]+$/.test(host))) {
    throw new Error('OIDC_CONFIGURATION_MISSING');
  }
  return { key: Buffer.from(sessionSecret, 'base64url'), hosts };
}

function configuration() {
  const clientId = process.env.TG_OIDC_CLIENT_ID || '';
  const clientSecret = process.env.TG_OIDC_CLIENT_SECRET || '';
  if (!/^[1-9][0-9]{3,19}$/.test(clientId) || !clientSecret) {
    throw new Error('OIDC_CONFIGURATION_MISSING');
  }
  return { clientId, clientSecret, ...sessionConfiguration() };
}

function signed(value, key) {
  const body = base64url(JSON.stringify(value));
  const mac = base64url(createHmac('sha256', key).update(body).digest());
  return body + '.' + mac;
}

function verified(value, key) {
  if (typeof value !== 'string' || value.length > 5000) return null;
  const parts = value.split('.');
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0])
      || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return null;
  const expected = createHmac('sha256', key).update(parts[0]).digest();
  const received = Buffer.from(parts[1], 'base64url');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const result = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    return result && typeof result === 'object' && !Array.isArray(result) ? result : null;
  } catch {
    return null;
  }
}

function readCookies(event) {
  const raw = Object.entries(event.headers || {}).find(([key]) => key.toLowerCase() === 'cookie')?.[1] || '';
  if (typeof raw !== 'string' || raw.length > 9000) return {};
  const cookies = {};
  for (const item of raw.split(';')) {
    const split = item.indexOf('=');
    if (split < 1) continue;
    const name = item.slice(0, split).trim();
    const value = item.slice(split + 1).trim();
    if (!Object.hasOwn(cookies, name)) cookies[name] = value;
  }
  return cookies;
}

function cookie(name, value, maxAge) {
  return name + '=' + value + '; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=' + maxAge;
}

function browserSessionCookie(host, profile, key, now = epoch()) {
  const { sub, telegramUserId, name, username } = profile;
  const value = signed({ version: 2, host, sub, telegramUserId, name, username,
    iat: now, exp: now + SESSION_TTL }, key);
  return cookie(COOKIE_SESSION, value, SESSION_TTL);
}

function respond(status, body = '', headers = {}, cookies = []) {
  const response = {
    statusCode: status,
    isBase64Encoded: false,
    headers: { ...NO_CACHE, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
  if (cookies.length) response.multiValueHeaders = { 'Set-Cookie': cookies };
  return response;
}
function json(status, value, cookies = []) {
  return respond(status, value, { 'Content-Type': 'application/json; charset=utf-8' }, cookies);
}
function navigate(url, cookies = []) {
  return respond(302, '', { Location: url }, cookies);
}

function getHost(event, config) {
  const host = requestHeader(event, 'host');
  if (typeof host !== 'string' || !config.hosts.includes(host)) return null;
  return host;
}

function checkOrigin(event, host) {
  return requestHeader(event, 'origin') === 'https://' + host;
}

function requestHeader(event, name) {
  return Object.entries(event.headers || {}).find(([key]) => key.toLowerCase() === name)?.[1];
}

function parameters(event) {
  const params = event.multiValueQueryStringParameters;
  const single = event.queryStringParameters || {};
  if (!params) return single;
  for (const [key, values] of Object.entries(params)) {
    if (!Array.isArray(values) || values.length !== 1 || typeof values[0] !== 'string') return null;
    if (Object.hasOwn(single, key) && single[key] !== values[0]) return null;
  }
  return single;
}

// Diagnostics contain only fixed codes and an optional HTTP status. Never log
// upstream response bodies, error messages, headers, tokens, or user identity.
class OidcCheckError extends Error {
  constructor(stage, code, httpStatus = null) {
    super('OIDC_VERIFICATION_FAILED');
    this.stage = stage;
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function networkFailureCode(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'timeout';
  const cause = error?.cause?.code;
  if (cause === 'ENOTFOUND' || cause === 'EAI_AGAIN') return 'dns';
  if (cause === 'ETIMEDOUT' || cause === 'UND_ERR_CONNECT_TIMEOUT') return 'timeout';
  if (cause === 'ECONNREFUSED' || cause === 'ENETUNREACH' || cause === 'EHOSTUNREACH') return 'connect';
  if (cause === 'CERT_HAS_EXPIRED' || cause === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
      || cause === 'ERR_TLS_CERT_ALTNAME_INVALID') return 'tls';
  return 'network';
}

async function fetchJson(url, options, stage) {
  let response;
  try {
    response = await fetch(url, {
      ...options, redirect: 'error', signal: AbortSignal.timeout(7000),
    });
  } catch (error) {
    throw new OidcCheckError(stage, networkFailureCode(error));
  }
  if (!response.ok) throw new OidcCheckError(stage, 'http_error', response.status);
  if (Number(response.headers.get('content-length') || 0) > 65536) {
    throw new OidcCheckError(stage, 'response_too_large');
  }
  let text;
  try {
    text = await response.text();
  } catch {
    throw new OidcCheckError(stage, 'body_read_failure');
  }
  if (text.length > 65536) throw new OidcCheckError(stage, 'response_too_large');
  try {
    return JSON.parse(text);
  } catch {
    throw new OidcCheckError(stage, 'invalid_json');
  }
}

function invalidClaimCode(claims, config, nonce, telegramUserId, now = epoch()) {
  if (!claims || typeof claims !== 'object') return 'claims_payload_invalid';
  if (claims.iss !== ISSUER) return 'claims_issuer_mismatch';
  if (claims.aud !== config.clientId) return 'claims_audience_mismatch';
  if (typeof claims.sub !== 'string' || claims.sub.length < 1 || claims.sub.length > 100) {
    return 'claims_subject_invalid';
  }
  if (telegramUserId === undefined) return 'claims_telegram_id_missing';
  if (telegramUserId === null) return 'claims_telegram_id_null';
  if (typeof telegramUserId === 'string') return 'claims_telegram_id_invalid';
  if (typeof telegramUserId !== 'number') return 'claims_telegram_id_wrong_type';
  if (!Number.isSafeInteger(telegramUserId) || telegramUserId <= 0) return 'claims_telegram_id_number_invalid';
  if (!Number.isInteger(claims.exp)) return 'claims_exp_invalid';
  if (claims.exp <= now) return 'claims_token_expired';
  if (!Number.isInteger(claims.iat)) return 'claims_iat_invalid';
  if (claims.iat > now + 60) return 'claims_iat_in_future';
  if (claims.iat < now - 600) return 'claims_iat_too_old';
  if (claims.nonce !== nonce) {
    return claims.nonce === undefined ? 'claims_nonce_missing' : 'claims_nonce_mismatch';
  }
  return null;
}

function getKeys() {
  return fetchJson(JWKS_SOURCE, {}, 'jwks').then(keys => {
    if (!keys || !Array.isArray(keys.keys)) throw new OidcCheckError('jwks', 'invalid_keys');
    return keys;
  });
}

async function readMirrorObject(bucket, name, token) {
  let response;
  try {
    response = await fetch(`https://storage.yandexcloud.net/${bucket}/${name}`, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error', signal: AbortSignal.timeout(3000),
    });
  } catch (error) {
    throw new OidcCheckError('jwks', networkFailureCode(error));
  }
  if (!response.ok) throw new OidcCheckError('jwks', 'mirror_http_error', response.status);
  if (!response.body) throw new OidcCheckError('jwks', 'mirror_invalid');
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 65536) throw new OidcCheckError('jwks', 'response_too_large');
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof OidcCheckError) throw error;
    throw new OidcCheckError('jwks', 'body_read_failure');
  }
  return Buffer.concat(chunks, size);
}

function parseMirrorJson(bytes) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new OidcCheckError('jwks', 'mirror_invalid');
  }
}

async function loadMirrorKeys(bucket, token, retry = true) {
  const [statusBytes, keysBytes] = await Promise.all([
    readMirrorObject(bucket, 'status.json', token),
    readMirrorObject(bucket, 'jwks.json', token),
  ]);
  const status = parseMirrorJson(statusBytes);
  if (status?.source !== JWKS_SOURCE || typeof status.checkedAt !== 'string'
      || typeof status.jwksSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(status.jwksSha256)) {
    throw new OidcCheckError('jwks', 'mirror_invalid');
  }
  const checkedAt = Date.parse(status.checkedAt);
  const fetchedAt = Date.now();
  if (!Number.isFinite(checkedAt) || checkedAt > fetchedAt + 30_000 || fetchedAt - checkedAt >= JWKS_TTL) {
    throw new OidcCheckError('jwks', 'mirror_stale');
  }
  if (createHash('sha256').update(keysBytes).digest('hex') !== status.jwksSha256) {
    // The publisher writes keys before the heartbeat. Re-read a pair caught during rotation.
    if (retry) return loadMirrorKeys(bucket, token, false);
    throw new OidcCheckError('jwks', 'mirror_digest_mismatch');
  }
  const value = parseMirrorJson(keysBytes);
  if (!Array.isArray(value?.keys) || !value.keys.length) {
    throw new OidcCheckError('jwks', 'invalid_keys');
  }
  return { value, fetchedAt, expiresAt: checkedAt + JWKS_TTL };
}

async function getMirrorKeys(bucket, token, kid) {
  if (!/^mezfit-telegram-jwks-[a-z0-9]{1,43}$/.test(bucket) || typeof token !== 'string' || !token) {
    throw new OidcCheckError('jwks', 'mirror_not_configured');
  }
  const now = Date.now();
  const age = mirrorKeys ? now - mirrorKeys.fetchedAt : Infinity;
  if (mirrorKeys?.bucket === bucket && now < mirrorKeys.expiresAt && age < MIRROR_REFRESH
      && (age < 5_000 || mirrorKeys.value.keys.some(key => key?.kid === kid))) {
    return mirrorKeys.value;
  }
  if (mirrorKeysRequest?.bucket !== bucket) {
    const request = loadMirrorKeys(bucket, token).then(result => {
      mirrorKeys = { ...result, bucket };
      return result.value;
    });
    const pending = { bucket, request };
    mirrorKeysRequest = pending;
    try {
      return await request;
    } finally {
      if (mirrorKeysRequest === pending) mirrorKeysRequest = undefined;
    }
  }
  return mirrorKeysRequest.request;
}

async function getPopupKeys(kid) {
  const age = popupKeys ? Date.now() - popupKeys.fetchedAt : Infinity;
  if (age < JWKS_TTL && (age < 30_000 || popupKeys.value.keys.some(key => key?.kid === kid))) {
    return popupKeys.value;
  }
  popupKeysRequest ??= getKeys().then(value => {
    popupKeys = { value, fetchedAt: Date.now() };
    return value;
  }).finally(() => { popupKeysRequest = undefined; });
  return popupKeysRequest;
}

async function authenticateIdToken(idToken, config, nonce, loadKeys = getKeys, detailedClaims = false) {
  if (typeof idToken !== 'string' || idToken.length > MAX_JWT_LENGTH) {
    throw new OidcCheckError('jwt', 'invalid_token');
  }
  const parts = idToken.split('.');
  if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) {
    throw new OidcCheckError('jwt', 'invalid_token');
  }
  let header, claims;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new OidcCheckError('jwt', 'invalid_token');
  }
  if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid
      || (header.typ !== undefined && header.typ !== 'JWT')) {
    throw new OidcCheckError('jwt', 'unsupported_algorithm');
  }
  const keys = await loadKeys(header.kid);
  const match = keys.keys.filter(k => k?.kid === header.kid && k.kty === 'RSA'
    && (k.alg === undefined || k.alg === 'RS256')
    && (k.use === undefined || k.use === 'sig') && typeof k.n === 'string'
    && typeof k.e === 'string');
  if (match.length !== 1) throw new OidcCheckError('jwks', 'matching_key_not_found');
  let key;
  try {
    key = createPublicKey({ key: match[0], format: 'jwk' });
  } catch {
    throw new OidcCheckError('jwks', 'invalid_public_key');
  }
  const signature = Buffer.from(parts[2], 'base64url');
  let validSignature;
  try {
    validSignature = verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), key, signature);
  } catch {
    throw new OidcCheckError('jwt', 'signature_check_failure');
  }
  if (!validSignature) throw new OidcCheckError('jwt', 'invalid_signature');
  const id = claims?.id;
  const telegramUserId = typeof id === 'string' && /^[1-9][0-9]*$/.test(id) ? Number(id) : id;
  const claimCode = invalidClaimCode(claims, config, nonce, telegramUserId);
  if (claimCode) {
    throw new OidcCheckError('jwt', detailedClaims ? claimCode : 'invalid_claims');
  }
  if (loadKeys === getPopupKeys && (claims.exp <= claims.iat || claims.exp - claims.iat > 86400)) {
    throw new OidcCheckError('jwt', 'claims_token_lifetime_invalid');
  }
  return {
    sub: claims.sub,
    telegramUserId,
    name: typeof claims.name === 'string' ? claims.name.slice(0, 120) : '',
    username: typeof claims.preferred_username === 'string'
      ? claims.preferred_username.slice(0, 64) : '',
  };
}

async function start(config, host) {
  const state = base64url(randomBytes(24));
  const nonce = base64url(randomBytes(24));
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const flow = signed({ state, nonce, verifier, host, iat: epoch() }, config.key);
  const url = new URL(ISSUER + '/auth');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', 'https://' + host + '/auth/callback');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid profile');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return navigate(url.toString(), [cookie(COOKIE_FLOW, flow, FLOW_TTL)]);
}

async function callback(event, config, host) {
  const params = parameters(event);
  const clearFlow = cookie(COOKIE_FLOW, '', 0);
  if (!params || params.error || typeof params.code !== 'string' || !/^[a-zA-Z0-9_.~-]{8,2048}$/.test(params.code)
      || typeof params.state !== 'string') {
    return json(400, { error: 'TELEGRAM_LOGIN_CANCELLED' }, [clearFlow]);
  }
  const flow = verified(readCookies(event)[COOKIE_FLOW], config.key);
  if (!flow || flow.host !== host || flow.state !== params.state
      || typeof flow.nonce !== 'string' || typeof flow.verifier !== 'string'
      || !Number.isInteger(flow.iat) || flow.iat > epoch() + 60
      || flow.iat < epoch() - FLOW_TTL) {
    return json(401, { error: 'TELEGRAM_LOGIN_STATE_INVALID' }, [clearFlow]);
  }
  try {
    const credentials = Buffer.from(config.clientId + ':' + config.clientSecret).toString('base64');
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: 'https://' + host + '/auth/callback',
      client_id: config.clientId,
      code_verifier: flow.verifier,
    });
    const result = await fetchJson(ISSUER + '/token', {
      method: 'POST',
      headers: { Authorization: 'Basic ' + credentials,
        'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    }, 'token');
    if (!result || typeof result !== 'object' || typeof result.id_token !== 'string') {
      throw new OidcCheckError('token', 'missing_id_token');
    }
    const profile = await authenticateIdToken(result.id_token, config, flow.nonce);
    return navigate('/', [clearFlow, browserSessionCookie(host, profile, config.key)]);
  } catch (error) {
    return verificationFailure(error, clearFlow);
  }
}

function verificationFailure(error, clearFlow) {
  const incidentId = base64url(randomBytes(12));
  const diagnostic = error instanceof OidcCheckError
    ? { stage: error.stage, code: error.code, ...(error.httpStatus === null
      ? {} : { httpStatus: error.httpStatus }) }
    : { stage: 'internal', code: 'unclassified' };
  console.warn(JSON.stringify({ event: 'mezfit.browser_oidc.failure', incidentId, ...diagnostic }));
  return json(401, { error: 'TELEGRAM_LOGIN_VERIFICATION_FAILED',
    incidentId, ...diagnostic }, [clearFlow]);
}

function popupPayload(event) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(requestHeader(event, 'content-type') || '')
      || typeof event.body !== 'string' || event.body.length > (MAX_JWT_LENGTH + 128) * 2) return null;
  const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  if (Buffer.byteLength(body) > MAX_JWT_LENGTH + 128) return null;
  try {
    const value = JSON.parse(body);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

async function consumePopupNonce(bucket, nonce, token) {
  if (!token) throw new OidcCheckError('challenge', 'storage_credentials_missing');
  const marker = createHash('sha256').update(nonce).digest('hex');
  let response;
  try {
    response = await fetch(`https://storage.yandexcloud.net/${bucket}/used/${marker}`, {
      method: 'PUT', body: '', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { Authorization: `Bearer ${token}`, 'If-None-Match': '*' },
    });
  } catch (error) {
    throw new OidcCheckError('challenge', networkFailureCode(error));
  }
  if (response.status === 412 || response.status === 409) {
    throw new OidcCheckError('challenge', 'already_used');
  }
  if (!response.ok) throw new OidcCheckError('challenge', 'storage_http_error', response.status);
}

async function popup(event, context, config, host) {
  if (!checkOrigin(event, host)) return json(403, { error: 'ORIGIN_MISMATCH' });
  const bucket = process.env.MEZFIT_BROWSER_CHALLENGE_BUCKET || '';
  const clientId = Number(config.clientId);
  if (!/^mezfit-browser-nonce-[a-z0-9]{8,32}$/.test(bucket) || !Number.isSafeInteger(clientId)) {
    return json(503, { error: 'TELEGRAM_LOGIN_POPUP_NOT_CONFIGURED' });
  }
  const payload = popupPayload(event);
  if (!payload) return json(400, { error: 'TELEGRAM_LOGIN_INVALID_REQUEST' });
  if (event.path === '/auth/start') {
    const nonce = base64url(randomBytes(32));
    const challenge = signed({ nonce, host, iat: epoch() }, config.key);
    return json(200, { nonce, clientId, expiresIn: POPUP_TTL }, [cookie(COOKIE_POPUP, challenge, POPUP_TTL)]);
  }
  const clear = cookie(COOKIE_POPUP, '', 0);
  try {
    const flow = verified(readCookies(event)[COOKIE_POPUP], config.key);
    if (!flow || flow.host !== host || typeof flow.nonce !== 'string'
        || !Number.isInteger(flow.iat) || flow.iat > epoch() || flow.iat + POPUP_TTL <= epoch()) {
      throw new OidcCheckError('challenge', 'invalid_or_expired');
    }
    const token = context?.token?.access_token;
    const mirrorBucket = process.env.MEZFIT_BROWSER_JWKS_BUCKET;
    const loadKeys = mirrorBucket === undefined ? getPopupKeys : kid => getMirrorKeys(mirrorBucket, token, kid);
    const profile = await authenticateIdToken(payload.idToken, config, flow.nonce, loadKeys, true);
    if (flow.iat + POPUP_TTL <= epoch()) throw new OidcCheckError('challenge', 'invalid_or_expired');
    await consumePopupNonce(bucket, flow.nonce, token);
    return json(200, { authenticated: true }, [clear, browserSessionCookie(host, profile, config.key)]);
  } catch (error) {
    return verificationFailure(error, clear);
  }
}

function verifiedSession(event, config, host, now) {
  const data = verified(readCookies(event)[COOKIE_SESSION], config.key);
  if (!data || (data.version !== 1 && data.version !== 2) || data.host !== host
      || !Number.isSafeInteger(data.telegramUserId) || data.telegramUserId <= 0
      || typeof data.sub !== 'string' || !data.sub
      || !Number.isInteger(data.iat) || data.iat > now + 60
      || !Number.isInteger(data.exp) || data.exp <= now
      || data.exp > data.iat + (data.version === 1 ? LEGACY_SESSION_TTL : SESSION_TTL)) {
    return null;
  }
  return data;
}

function session(event, config, host) {
  const now = epoch();
  const data = verifiedSession(event, config, host, now);
  if (!data) return json(401, { authenticated: false });
  const cookies = data.version === 1 || now - data.iat >= SESSION_RENEW_INTERVAL
    ? [browserSessionCookie(host, data, config.key, now)] : [];
  return json(200, {
    authenticated: true,
    telegramUserId: String(data.telegramUserId),
    name: typeof data.name === 'string' ? data.name : '',
    username: typeof data.username === 'string' ? data.username : '',
  }, cookies);
}

function tokenError(status, code, message) {
  return json(status, { error: { code, message } });
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function tokenExchangeFailure(stage, status = null) {
  console.error('DEXIE_CLOUD_TOKEN_EXCHANGE_FAILED', { stage, upstreamStatus: status });
  const code = stage === 'contract' || stage === 'json' ? 'INVALID_CLOUD_RESPONSE' : 'DEXIE_CLOUD_UNAVAILABLE';
  return tokenError(502, code, 'Cloud authentication failed');
}

async function dexieTokens(event, config, host) {
  if (!checkOrigin(event, host)) return tokenError(403, 'ORIGIN_MISMATCH', 'Forbidden origin');
  const identity = verifiedSession(event, config, host, epoch());
  if (!identity) return tokenError(401, 'UNAUTHORIZED', 'Browser authentication required');

  let body;
  try {
    if (typeof event.body !== 'string') return tokenError(400, 'INVALID_JSON', 'Request body must be valid JSON');
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    body = JSON.parse(raw);
  } catch {
    return tokenError(400, 'INVALID_JSON', 'Request body must be valid JSON');
  }
  if (!isRecord(body) || typeof body.public_key !== 'string'
      || body.public_key.length < 1 || body.public_key.length > MAX_DEVICE_KEY_LENGTH) {
    return tokenError(400, 'INVALID_PUBLIC_KEY', 'Cloud device public key is required');
  }

  const { DEXIE_CLOUD_CLIENT_ID: clientId, DEXIE_CLOUD_CLIENT_SECRET: clientSecret,
    DEXIE_CLOUD_DB_URL: dbUrl } = process.env;
  if (!clientId || !clientSecret || !/^https:\/\/[a-z0-9-]+\.dexie\.cloud$/.test(dbUrl)) {
    return tokenError(503, 'DEXIE_CLOUD_UNAVAILABLE', 'Cloud authentication is not configured');
  }

  const subject = 'tg:' + identity.telegramUserId;
  let upstream;
  try {
    upstream = await fetch(dbUrl + '/token', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        scopes: ['ACCESS_DB'],
        public_key: body.public_key,
        client_id: clientId,
        client_secret: clientSecret,
        claims: { sub: subject, name: typeof identity.name === 'string' ? identity.name : '' },
      }),
    });
  } catch {
    return tokenExchangeFailure('fetch');
  }
  if (!upstream.ok) return tokenExchangeFailure('http', upstream.status);

  let token;
  try {
    token = await upstream.json();
  } catch {
    return tokenExchangeFailure('json', upstream.status);
  }
  if (!isRecord(token) || token.type !== 'tokens'
      || typeof token.accessToken !== 'string' || token.accessToken.length === 0
      || !Number.isFinite(token.accessTokenExpiration)
      || !isRecord(token.claims) || token.claims.sub !== subject
      || !['demo', 'eval', 'prod', 'client'].includes(token.userType)) {
    return tokenExchangeFailure('contract', upstream.status);
  }
  return json(200, token);
}

async function handler(event, context) {
  const isTokenRoute = event.path === DEXIE_TOKEN_PATH;
  const method = event.httpMethod;
  if (isTokenRoute && method !== 'POST') {
    return tokenError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  }
  let config;
  try {
    config = isTokenRoute ? sessionConfiguration() : configuration();
  } catch {
    if (isTokenRoute) return tokenError(503, 'DEXIE_CLOUD_UNAVAILABLE', 'Cloud authentication is not configured');
    return json(503, { error: 'TELEGRAM_LOGIN_NOT_CONFIGURED' });
  }
  const host = getHost(event, config);
  if (!host) {
    if (isTokenRoute) return tokenError(403, 'UNAPPROVED_AUTH_HOST', 'Forbidden host');
    return json(403, { error: 'UNAPPROVED_AUTH_HOST' });
  }
  switch (event.path) {
    case DEXIE_TOKEN_PATH:
      return dexieTokens(event, config, host);
    case '/auth/start':
      if (method === 'POST') return popup(event, context, config, host);
      return method === 'GET' ? start(config, host) : json(405, { error: 'METHOD_NOT_ALLOWED' });
    case '/auth/callback':
      if (method === 'POST') return popup(event, context, config, host);
      return method === 'GET'
        ? callback(event, config, host) : json(405, { error: 'METHOD_NOT_ALLOWED' });
    case '/auth/session':
      return method === 'GET'
        ? session(event, config, host) : json(405, { error: 'METHOD_NOT_ALLOWED' });
    case '/auth/logout':
      if (method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
      if (!checkOrigin(event, host)) return json(403, { error: 'ORIGIN_MISMATCH' });
      return json(200, { authenticated: false },
        [cookie(COOKIE_SESSION, '', 0), cookie(COOKIE_FLOW, '', 0),
          ...(process.env.MEZFIT_BROWSER_CHALLENGE_BUCKET ? [cookie(COOKIE_POPUP, '', 0)] : [])]);
    default:
      return json(404, { error: 'NOT_FOUND' });
  }
}

exports.handler = handler;
exports._test = { signed, verified, checkOrigin, readCookies,
  configuration, authenticateIdToken, session, start, callback, parameters };
