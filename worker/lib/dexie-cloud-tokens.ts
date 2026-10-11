import cloudConfig from '../../dexie-cloud.json';
import { TelegramAuthError, validateTelegramInitData } from './telegram';

export interface DexieCloudTokenEnv {
  TELEGRAM_BOT_TOKEN: string;
  DEXIE_CLOUD_CLIENT_ID?: string;
  DEXIE_CLOUD_CLIENT_SECRET?: string;
}

/**
 * The subject must be stable on every device and must only come from verified Telegram initData.
 * The older D1 app_user numeric ID is intentionally not reused.
 */
export function cloudUserId(telegramUserId: number): string {
  if (!Number.isSafeInteger(telegramUserId) || telegramUserId <= 0) {
    throw new Error('INVALID_TELEGRAM_USER_ID');
  }
  return `tg:${telegramUserId}`;
}

function error(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type CloudTokenFailureStage = 'fetch' | 'http' | 'json' | 'contract';

/** Fixed operational fields only: never log upstream errors, payloads, headers or user details. */
function logCloudTokenFailure(stage: CloudTokenFailureStage, upstreamStatus: number | null): void {
  console.error('DEXIE_CLOUD_TOKEN_EXCHANGE_FAILED', { stage, upstreamStatus });
}

/**
 * Privileged token exchange only. Domain writes must use Dexie Cloud Addon,
 * not the Worker. Never return or log the service-account credentials.
 */
export async function handleDexieCloudTokenRoute(
  request: Request,
  env: DexieCloudTokenEnv,
  fetchUpstream: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== 'POST') return error(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');

  let identity: Awaited<ReturnType<typeof validateTelegramInitData>>;
  try {
    identity = await validateTelegramInitData(
      request.headers.get('x-telegram-init-data') ?? '',
      env.TELEGRAM_BOT_TOKEN,
    );
  } catch (cause) {
    if (cause instanceof TelegramAuthError) return error(401, 'UNAUTHORIZED', 'Telegram authentication required');
    throw cause;
  }

  if (!env.DEXIE_CLOUD_CLIENT_ID || !env.DEXIE_CLOUD_CLIENT_SECRET) {
    return error(503, 'DEXIE_CLOUD_UNAVAILABLE', 'Cloud authentication is not configured');
  }

  // fetchTokens supplies a generated, non-exportable device key's public half.
  // Client hints never determine the cloud identity or its authorization.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(400, 'INVALID_JSON', 'Request body must be valid JSON');
  }

  if (!isRecord(body) || typeof body.public_key !== 'string'
    || body.public_key.length < 1 || body.public_key.length > 8192) {
    return error(400, 'INVALID_PUBLIC_KEY', 'Cloud device public key is required');
  }

  const subject = cloudUserId(identity.user.id);
  let upstream: Response;
  try {
    upstream = await fetchUpstream(`${cloudConfig.dbUrl}/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        scopes: ['ACCESS_DB'],
        public_key: body.public_key,
        client_id: env.DEXIE_CLOUD_CLIENT_ID,
        client_secret: env.DEXIE_CLOUD_CLIENT_SECRET,
        claims: {
          sub: subject,
          name: [identity.user.first_name, identity.user.last_name].filter(Boolean).join(' '),
        },
      }),
    });
  } catch {
    logCloudTokenFailure('fetch', null);
    return error(502, 'DEXIE_CLOUD_UNAVAILABLE', 'Cloud authentication failed');
  }

  if (!upstream.ok) {
    logCloudTokenFailure('http', upstream.status);
    return error(502, 'DEXIE_CLOUD_UNAVAILABLE', 'Cloud authentication failed');
  }

  let token: unknown;
  try {
    token = await upstream.json();
  } catch {
    logCloudTokenFailure('json', upstream.status);
    return error(502, 'INVALID_CLOUD_RESPONSE', 'Cloud authentication failed');
  }

  if (!isRecord(token) || token.type !== 'tokens'
    || typeof token.accessToken !== 'string' || token.accessToken.length === 0
    || typeof token.accessTokenExpiration !== 'number'
    || !isRecord(token.claims) || token.claims.sub !== subject
    || !['demo', 'eval', 'prod', 'client'].includes(String(token.userType))) {
    logCloudTokenFailure('contract', upstream.status);
    return error(502, 'INVALID_CLOUD_RESPONSE', 'Cloud authentication failed');
  }

  // Pass through the standard Dexie Cloud token envelope including the
  // optional refresh token. Do not cache authenticated token responses.
  return Response.json(token, { headers: { 'Cache-Control': 'no-store' } });
}
