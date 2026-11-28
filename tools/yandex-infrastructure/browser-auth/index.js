'use strict';

/**
 * Browser-only Telegram sign-in bridge for Yandex Cloud Functions (Node.js 22).
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
const LOGIN_URL_PATH = '/auth/telegram-login';
const LOGIN_URL_HOST = 'mezfit.online';
const LOGIN_URL_TTL = 120;
const LOGIN_URL_PURPOSE = 'telegram-login-url';
const DEXIE_TOKEN_PATH = '/api/dexie-cloud/tokens';
const MAX_DEVICE_KEY_LENGTH = 8192;
const PASSWORD_USER_ID_MIN = 2 ** 52;
const ACCOUNT_LOOKUP_TIMEOUT = 6000;
const ACCOUNT_LOOKUP = `
  DECLARE $telegram_id AS Utf8;
  SELECT telegram_id AS user_id, external_telegram_id, identity_state, snapshot,
    CAST(revision AS Utf8) AS revision
  FROM account_replica VIEW account_external_telegram_idx
  WHERE external_telegram_id = $telegram_id
  LIMIT 2;
`;
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
  const value = signed({
    version: profile.account ? 3 : 2, host, sub, telegramUserId, name, username,
    ...(profile.account ? { account: profile.account } : {}),
    iat: now, exp: now + SESSION_TTL,
  }, key);
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
    const profile = await verifiedProfileForSession(
      await authenticateIdToken(result.id_token, config, flow.nonce), config,
    );
    if (!profile) return json(503, { error: 'ACCOUNT_IDENTITY_UNAVAILABLE' }, [clearFlow]);
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
    const profile = await verifiedProfileForSession(
      await authenticateIdToken(payload.idToken, config, flow.nonce, loadKeys, true), config,
    );
    if (!profile) return json(503, { error: 'ACCOUNT_IDENTITY_UNAVAILABLE' });
    if (flow.iat + POPUP_TTL <= epoch()) throw new OidcCheckError('challenge', 'invalid_or_expired');
    await consumePopupNonce(bucket, flow.nonce, token);
    return json(200, { authenticated: true }, [clear, browserSessionCookie(host, profile, config.key)]);
  } catch (error) {
    return verificationFailure(error, clear);
  }
}

function canonicalAccountId(value) {
  return typeof value === 'string' && /^[1-9][0-9]{0,15}$/.test(value)
    && Number.isSafeInteger(Number(value));
}

function accountMappingEnabled() {
  return process.env.MEZFIT_BROWSER_YDB_IDENTITY_ENABLED === 'true';
}

async function readYdbAccount(telegramId, context) {
  const database = process.env.MEZFIT_BROWSER_ACCOUNT_YDB_PATH;
  const token = context?.token?.access_token;
  if (typeof token !== 'string' || !token || !/^\/ru-central1\/[a-z0-9]+\/[a-z0-9]+$/.test(database || '')) {
    throw new Error('ACCOUNT_REPLICA_NOT_CONFIGURED');
  }

  // The browser function uses its own IAM identity. The replica sender secret is not used.
  const { AUTO_TX, Driver, ExecuteQuerySettings, OperationParams, TokenAuthService, TypedData, TypedValues } = require('ydb-sdk');
  const driver = new Driver({
    connectionString: 'grpcs://ydb.serverless.yandexcloud.net:2135' + database,
    authService: new TokenAuthService(token),
    poolSettings: { minLimit: 0, maxLimit: 1 },
  });
  let timer;
  try {
    const read = async () => {
      if (!await driver.ready(2000)) throw new Error('ACCOUNT_REPLICA_UNAVAILABLE');
      const result = await driver.tableClient.withSession(session => session.executeQuery(
        ACCOUNT_LOOKUP, { $telegram_id: TypedValues.utf8(telegramId) }, AUTO_TX,
        new ExecuteQuerySettings().withOperationParams(
          new OperationParams().withOperationTimeoutSeconds(3),
        ),
      ), 2000);
      if (result.resultSets.length !== 1 || result.resultSets[0].truncated) {
        throw new Error('INVALID_ACCOUNT_REPLICA_RESULT');
      }
      return TypedData.createNativeObjects(result.resultSets[0]);
    };
    return await Promise.race([
      read(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('ACCOUNT_REPLICA_TIMEOUT')), ACCOUNT_LOOKUP_TIMEOUT);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    void driver.destroy().catch(() => {});
  }
}

async function resolveBrowserAccount(profile, config) {
  const telegramId = String(profile.telegramUserId);
  if (!canonicalAccountId(telegramId) || Number(telegramId) >= PASSWORD_USER_ID_MIN) return null;
  try {
    const rows = await config.readAccount(telegramId);
    if (!Array.isArray(rows) || rows.length !== 1) return null;
    const row = rows[0];
    if (!isRecord(row) || row.identity_state !== 'active' || row.external_telegram_id !== telegramId
        || !canonicalAccountId(row.user_id) || !canonicalAccountId(row.revision)
        || typeof row.snapshot !== 'string') return null;
    // Only the current Telegram-first identity class can receive a production subject.
    if (row.user_id !== telegramId || Number(row.user_id) >= PASSWORD_USER_ID_MIN) return null;
    const account = { userId: row.user_id, revision: Number(row.revision) };
    if (profile.version === 3 && (profile.account.userId !== account.userId
        || account.revision < profile.account.revision)) return null;
    const snapshot = JSON.parse(row.snapshot);
    if (!isRecord(snapshot?.user) || snapshot.user.telegramUserId !== telegramId
        || !Number.isSafeInteger(snapshot.user.id) || snapshot.user.id <= 0) return null;
    return account;
  } catch {
    return null;
  }
}

async function verifiedProfileForSession(profile, config) {
  if (!accountMappingEnabled()) return profile;
  const account = await resolveBrowserAccount(profile, config);
  return account ? { ...profile, account } : null;
}

function verifiedSession(event, config, host, now) {
  const data = verified(readCookies(event)[COOKIE_SESSION], config.key);
  if (!data || ![1, 2, 3].includes(data.version) || data.host !== host
      || !Number.isSafeInteger(data.telegramUserId) || data.telegramUserId <= 0
      || typeof data.sub !== 'string' || !data.sub
      || (data.version === 3 && (!isRecord(data.account) || data.account.userId !== String(data.telegramUserId)
        || data.telegramUserId >= PASSWORD_USER_ID_MIN
        || !Number.isSafeInteger(data.account.revision) || data.account.revision <= 0))
      || !Number.isInteger(data.iat) || data.iat > now + 60
      || !Number.isInteger(data.exp) || data.exp <= now
      || data.exp > data.iat + (data.version === 1 ? LEGACY_SESSION_TTL : SESSION_TTL)) {
    return null;
  }
  return data;
}

async function session(event, config, host) {
  const now = epoch();
  const data = verifiedSession(event, config, host, now);
  if (!data) return json(401, { authenticated: false });
  const profile = await verifiedProfileForSession(data, config);
  if (!profile) return json(503, { error: 'ACCOUNT_IDENTITY_UNAVAILABLE' });
  const cookies = data.version === 1 || now - data.iat >= SESSION_RENEW_INTERVAL
    || (accountMappingEnabled() && profile.account.revision !== data.account?.revision)
    ? [browserSessionCookie(host, profile, config.key, now)] : [];
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

  const profile = await verifiedProfileForSession(identity, config);
  if (!profile) return tokenError(503, 'DEXIE_CLOUD_UNAVAILABLE', 'Cloud authentication failed');
  const subject = 'tg:' + (accountMappingEnabled() ? profile.account.userId : identity.telegramUserId);
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

function loginUrlParameters(event) {
  const single = event.queryStringParameters ?? {};
  const multi = event.multiValueQueryStringParameters;
  if (!isRecord(single) || (multi != null && !isRecord(multi))) return null;
  const keys = Object.keys(single);
  if (keys.length === 0 && (!multi || Object.keys(multi).length === 0)) return single;
  // This route requires the v1 Gateway event's complete multivalue map.
  if (!multi || Object.keys(multi).length !== keys.length) return null;
  let size = 0;
  for (const key of keys) {
    const value = single[key];
    const values = multi[key];
    if (!['id', 'first_name', 'last_name', 'username', 'photo_url', 'auth_date', 'hash'].includes(key)
        || typeof value !== 'string' || !Array.isArray(values) || values.length !== 1 || values[0] !== value
        || /[\u0000-\u001f\u007f\uFFFD]/u.test(value)) return null;
    size += Buffer.byteLength(key) + Buffer.byteLength(value);
  }
  return size <= 4096 ? single : null;
}

function freshLoginUrl(authDate, now = epoch()) {
  return Number.isSafeInteger(authDate) && authDate > 0 && authDate <= now + 30
    && authDate + LOGIN_URL_TTL > now;
}

function loginUrlIdentity(values, key) {
  const { id, first_name: firstName, last_name: lastName = '', username = '',
    photo_url: photo = '', auth_date: date, hash } = values;
  if (!/^[1-9][0-9]{0,15}$/.test(id ?? '') || !Number.isSafeInteger(Number(id))
      || !/^[1-9][0-9]{0,15}$/.test(date ?? '') || !freshLoginUrl(Number(date))
      || !firstName?.trim() || firstName.length > 128 || lastName.length > 128
      || !/^[A-Za-z0-9_]{0,64}$/.test(username) || photo.length > 2048
      || (photo && !URL.canParse(photo)) || !/^[a-fA-F0-9]{64}$/.test(hash ?? '')) return null;
  const received = Buffer.from(hash, 'hex');
  const check = Object.keys(values).filter(name => name !== 'hash').sort()
    .map(name => name + '=' + values[name]).join('\n');
  const expected = createHmac('sha256', key).update(check).digest();
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  return {
    telegramUserId: Number(id), name: [firstName, lastName].filter(Boolean).join(' '),
    username, authDate: Number(date),
    marker: createHash('sha256').update(LOGIN_URL_PURPOSE + ':').update(received).digest('hex'),
  };
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function loginUrlPage(status, content, cookies = [], code) {
  return respond(status, '<!doctype html><html lang="ru"><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1"><title>Вход в Mezfit</title>'
    + '<main><h1>Вход в Mezfit</h1>' + content + '</main></html>', {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    'X-Frame-Options': 'DENY',
    ...(code ? { 'X-Mezfit-Login-Code': code } : {}),
  }, cookies);
}

async function telegramLoginUrl(event, context, config, host) {
  const method = event.httpMethod;
  if (method !== 'GET' && method !== 'POST') return respond(405, '', { Allow: 'GET, POST' });
  const values = loginUrlParameters(event);
  const hex = process.env.MEZFIT_TELEGRAM_LOGIN_URL_KEY || '';
  const configured = /^[0-9a-f]{64}$/.test(hex);
  const active = verifiedSession(event, config, host, epoch());

  // Share the existing short-lived challenge slot. Domain-separated signing
  // prevents confusion with OIDC popup challenges, and existing logout clears it.
  const pendingKey = createHmac('sha256', config.key).update(LOGIN_URL_PURPOSE).digest();
  const candidate = verified(readCookies(event)[COOKIE_POPUP], pendingKey);
  const pending = candidate?.host === host && candidate.purpose === LOGIN_URL_PURPOSE
    && Number.isSafeInteger(candidate.exp) && candidate.exp > epoch() ? candidate : null;
  const clear = cookie(COOKIE_POPUP, '', 0);
  const fallback = '<p><a href="/">Перейти на сайт и войти через Telegram</a></p>';
  const conflict = 'В этом браузере открыт другой аккаунт. Выйдите из него и снова откройте кнопку в боте.';
  const retry = 'Не удалось подтвердить вход. Откройте кнопку в боте снова или войдите с сайта.';
  const errorPage = (status, code, clearPending = true) => loginUrlPage(status,
    '<p>' + (code === 'ACCOUNT_CONFLICT' ? conflict : retry) + '</p>' + fallback, clearPending ? [clear] : [], code);
  const makePending = (fields, age) => cookie(COOKIE_POPUP, signed({
    ...fields, host, purpose: LOGIN_URL_PURPOSE, exp: epoch() + age,
  }, pendingKey), age);
  if (method === 'GET') {
    if (values && Object.keys(values).length === 0) {
      if (!pending) return navigate('/');
      if (pending.error) {
        const status = { NOT_CONFIGURED: 503, ACCOUNT_CONFLICT: 409 }[pending.error] ?? 400;
        return errorPage(status, pending.error);
      }
      if (active) return active.telegramUserId === pending.telegramUserId ? navigate('/', [clear])
        : errorPage(409, 'ACCOUNT_CONFLICT');
      return loginUrlPage(200, '<form method="post" action="' + LOGIN_URL_PATH + '">'
        + '<input type="hidden" name="nonce" value="' + pending.nonce + '">'
        + '<button name="action" value="confirm">Войти как ' + escapeHtml(pending.name) + '</button> '
        + '<button name="action" value="cancel">Отмена</button></form>');
    }
    const identity = values && configured && loginUrlIdentity(values, Buffer.from(hex, 'hex'));
    if (!identity || active && active.telegramUserId !== identity.telegramUserId) {
      const error = !configured ? 'NOT_CONFIGURED' : identity ? 'ACCOUNT_CONFLICT' : 'INVALID_OR_EXPIRED';
      return navigate(LOGIN_URL_PATH, [makePending({ error }, 30)]);
    }
    if (active) return navigate('/', pending ? [clear] : []);
    const age = Math.min(LOGIN_URL_TTL, identity.authDate + LOGIN_URL_TTL - epoch());
    if (age <= 0) return navigate(LOGIN_URL_PATH, [makePending({ error: 'INVALID_OR_EXPIRED' }, 30)]);
    return navigate(LOGIN_URL_PATH, [makePending({ ...identity, nonce: base64url(randomBytes(32)) }, age)]);
  }

  if (!checkOrigin(event, host)) return json(403, { error: 'ORIGIN_MISMATCH' });
  if (!values || Object.keys(values).length !== 0 || typeof event.body !== 'string' || event.body.length > 256
      || !/^application\/x-www-form-urlencoded(?:;\s*charset=utf-8)?$/i.test(requestHeader(event, 'content-type') || '')) {
    return json(400, { error: 'TELEGRAM_LOGIN_URL_INVALID_REQUEST' });
  }
  const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  const form = new URLSearchParams(body);
  const action = form.get('action');
  if (!pending || pending.error || [...form].length !== 2 || form.get('nonce') !== pending.nonce
      || !['confirm', 'cancel'].includes(action)) {
    return errorPage(400, 'INVALID_CONFIRMATION', false);
  }
  const redirect = cookies => respond(303, '', { Location: '/' }, cookies);
  if (action === 'cancel') return redirect([clear]);
  if (active) return active.telegramUserId === pending.telegramUserId ? redirect([clear])
    : errorPage(409, 'ACCOUNT_CONFLICT');

  const bucket = process.env.MEZFIT_BROWSER_CHALLENGE_BUCKET || '';
  if (!configured || !/^mezfit-browser-nonce-[a-z0-9]{8,32}$/.test(bucket)) {
    return errorPage(503, 'NOT_CONFIGURED');
  }
  if (!freshLoginUrl(pending.authDate)) return errorPage(400, 'INVALID_OR_EXPIRED');
  const profile = await verifiedProfileForSession(pending, config);
  if (!profile) return errorPage(503, 'ACCOUNT_IDENTITY_UNAVAILABLE', false);
  try {
    await consumePopupNonce(bucket, LOGIN_URL_PURPOSE + ':' + pending.marker, context?.token?.access_token);
  } catch (error) {
    const used = error instanceof OidcCheckError && error.code === 'already_used';
    return used ? errorPage(409, 'ALREADY_USED') : errorPage(503, 'REPLAY_STORAGE_UNAVAILABLE');
  }
  const now = epoch();
  if (pending.exp <= now || !freshLoginUrl(pending.authDate, now)) {
    return errorPage(400, 'INVALID_OR_EXPIRED');
  }
  return redirect([clear, browserSessionCookie(host, {
    ...profile, sub: LOGIN_URL_PURPOSE + ':' + pending.telegramUserId,
  }, config.key, now)]);
}

async function handleBrowserRequest(event, context, readAccount) {
  const isTokenRoute = event.path === DEXIE_TOKEN_PATH;
  const isLoginUrl = event.path === LOGIN_URL_PATH;
  const method = event.httpMethod;
  if (isTokenRoute && method !== 'POST') {
    return tokenError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  }
  let config;
  try {
    config = isTokenRoute || isLoginUrl ? sessionConfiguration() : configuration();
  } catch {
    if (isTokenRoute) return tokenError(503, 'DEXIE_CLOUD_UNAVAILABLE', 'Cloud authentication is not configured');
    return json(503, { error: 'TELEGRAM_LOGIN_NOT_CONFIGURED' });
  }
  config.readAccount = telegramId => readAccount(telegramId, context);
  const host = getHost(event, config);
  if (!host) {
    if (isTokenRoute) return tokenError(403, 'UNAPPROVED_AUTH_HOST', 'Forbidden host');
    return json(403, { error: 'UNAPPROVED_AUTH_HOST' });
  }
  if (isLoginUrl) {
    if (host !== LOGIN_URL_HOST) return json(403, { error: 'UNAPPROVED_AUTH_HOST' });
    return telegramLoginUrl(event, context, config, host);
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

async function handler(event, context) {
  return handleBrowserRequest(event, context, readYdbAccount);
}

exports.handler = handler;
exports._test = { signed, verified, checkOrigin, readCookies,
  configuration, authenticateIdToken, session, start, callback, parameters, handleBrowserRequest };
