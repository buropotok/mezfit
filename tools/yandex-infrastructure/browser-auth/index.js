'use strict';

/**
 * Browser-only Telegram OIDC bridge for Yandex Cloud Functions (Node.js 22).
 *
 * This is NOT a substitute for Telegram Mini App initData. A browser cookie
 * authorizes only the /auth/session endpoint, never legacy /api/ or Dexie ACL.
 * No bot token, OIDC secret or signing key is bundled with the source code.
 */
const {
  createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify,
} = require('node:crypto');

const ISSUER = 'https://oauth.telegram.org';
const COOKIE_FLOW = '__Host-mz_oidc_flow';
const COOKIE_SESSION = '__Host-mz_browser_session';
const FLOW_TTL = 600;
const SESSION_TTL = 12 * 60 * 60;
const MAX_JWT_LENGTH = 12000;
const NO_CACHE = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};
const base64url = (buffer) => Buffer.from(buffer).toString('base64url');
const epoch = () => Math.floor(Date.now() / 1000);

function configuration() {
  const clientId = process.env.TG_OIDC_CLIENT_ID || '';
  const clientSecret = process.env.TG_OIDC_CLIENT_SECRET || '';
  const sessionSecret = process.env.MEZFIT_BROWSER_SESSION_SECRET || '';
  const hosts = (process.env.MEZFIT_AUTH_HOSTS || '').split(',').map(x => x.trim());
  if (!/^[1-9][0-9]{3,19}$/.test(clientId) || !clientSecret
      || !/^[A-Za-z0-9_-]{43,}$/.test(sessionSecret)
      || Buffer.from(sessionSecret, 'base64url').length < 32
      || hosts.length === 0 || hosts.some(host => !/^[a-z0-9][a-z0-9.-]+$/.test(host))) {
    throw new Error('OIDC_CONFIGURATION_MISSING');
  }
  return { clientId, clientSecret, key: Buffer.from(sessionSecret, 'base64url'), hosts };
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
  const host = Object.entries(event.headers || {}).find(([key]) => key.toLowerCase() === 'host')?.[1];
  if (typeof host !== 'string' || !config.hosts.includes(host)) return null;
  return host;
}

function checkOrigin(event, host) {
  const origin = Object.entries(event.headers || {}).find(([key]) => key.toLowerCase() === 'origin')?.[1];
  return origin === 'https://' + host;
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

function validClaims(claims, config, nonce, now = epoch()) {
  if (!claims || typeof claims !== 'object' || claims.iss !== ISSUER
      || claims.aud !== config.clientId
      || typeof claims.sub !== 'string' || claims.sub.length < 1 || claims.sub.length > 100
      || !Number.isSafeInteger(claims.id) || claims.id <= 0
      || !Number.isInteger(claims.exp) || claims.exp <= now
      || !Number.isInteger(claims.iat) || claims.iat > now + 60 || claims.iat < now - 600
      || claims.nonce !== nonce) return null;
  return {
    sub: claims.sub,
    telegramUserId: claims.id,
    name: typeof claims.name === 'string' ? claims.name.slice(0, 120) : '',
    username: typeof claims.preferred_username === 'string'
      ? claims.preferred_username.slice(0, 64) : '',
  };
}

async function authenticateIdToken(idToken, config, nonce) {
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
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid
      || (header.typ !== undefined && header.typ !== 'JWT')) {
    throw new OidcCheckError('jwt', 'unsupported_algorithm');
  }
  const keys = await fetchJson(ISSUER + '/.well-known/jwks.json', {}, 'jwks');
  if (!keys || !Array.isArray(keys.keys)) throw new OidcCheckError('jwks', 'invalid_keys');
  const match = keys.keys.filter(k => k.kid === header.kid && k.kty === 'RSA'
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
  const profile = validClaims(claims, config, nonce);
  if (!profile) throw new OidcCheckError('jwt', 'invalid_claims');
  return profile;
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
    const session = signed({ version: 1, host, ...profile,
      iat: epoch(), exp: epoch() + SESSION_TTL }, config.key);
    return navigate('/', [
      clearFlow,
      cookie(COOKIE_SESSION, session, SESSION_TTL),
    ]);
  } catch (error) {
    const incidentId = base64url(randomBytes(12));
    const diagnostic = error instanceof OidcCheckError
      ? { stage: error.stage, code: error.code, ...(error.httpStatus === null
        ? {} : { httpStatus: error.httpStatus }) }
      : { stage: 'internal', code: 'unclassified' };
    console.warn(JSON.stringify({ event: 'mezfit.browser_oidc.failure', incidentId, ...diagnostic }));
    // The browser receives only a random incident ID; cause details stay in
    // server logs and never reveal credentials or Telegram token contents.
    return json(401, { error: 'TELEGRAM_LOGIN_VERIFICATION_FAILED', incidentId }, [clearFlow]);
  }
}

function session(event, config, host) {
  const data = verified(readCookies(event)[COOKIE_SESSION], config.key);
  if (!data || data.version !== 1 || data.host !== host
      || !Number.isSafeInteger(data.telegramUserId) || data.telegramUserId <= 0
      || typeof data.sub !== 'string' || !data.sub
      || !Number.isInteger(data.iat) || data.iat > epoch() + 60
      || !Number.isInteger(data.exp) || data.exp <= epoch()
      || data.exp > data.iat + SESSION_TTL) {
    return json(401, { authenticated: false });
  }
  return json(200, {
    authenticated: true,
    telegramUserId: String(data.telegramUserId),
    name: typeof data.name === 'string' ? data.name : '',
    username: typeof data.username === 'string' ? data.username : '',
  });
}

async function handler(event) {
  let config;
  try {
    config = configuration();
  } catch {
    return json(503, { error: 'TELEGRAM_LOGIN_NOT_CONFIGURED' });
  }
  const host = getHost(event, config);
  if (!host) return json(403, { error: 'UNAPPROVED_AUTH_HOST' });
  const method = event.httpMethod;
  switch (event.path) {
    case '/auth/start':
      return method === 'GET' ? start(config, host) : json(405, { error: 'METHOD_NOT_ALLOWED' });
    case '/auth/callback':
      return method === 'GET'
        ? callback(event, config, host) : json(405, { error: 'METHOD_NOT_ALLOWED' });
    case '/auth/session':
      return method === 'GET'
        ? session(event, config, host) : json(405, { error: 'METHOD_NOT_ALLOWED' });
    case '/auth/logout':
      if (method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
      if (!checkOrigin(event, host)) return json(403, { error: 'ORIGIN_MISMATCH' });
      return json(200, { authenticated: false },
        [cookie(COOKIE_SESSION, '', 0), cookie(COOKIE_FLOW, '', 0)]);
    default:
      return json(404, { error: 'NOT_FOUND' });
  }
}

exports.handler = handler;
exports._test = { signed, verified, validClaims, checkOrigin, readCookies,
  configuration, authenticateIdToken, session, start, callback, parameters };
