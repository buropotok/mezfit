import { DISCUSSION_MEDIA_KEY_PATTERN, discussionMediaSizeLimit } from '../../shared/discussion-media-limits';
import { TelegramAuthError, validateTelegramInitData } from './telegram';

/** Existing R2 bucket is reused under the isolated mvp-media/ namespace. */
const BUCKET = 'mezfit';
const EXPIRES_SECONDS = 600;
const encoder = new TextEncoder();

export interface DiscussionR2MediaEnv {
  TELEGRAM_BOT_TOKEN: string;
  R2_BINDING_MEZFIT: R2Bucket;
  R2_ACCOUNT_ID?: string;
  R2_MEDIA_ACCESS_KEY_ID?: string;
  R2_MEDIA_SECRET_ACCESS_KEY?: string;
}

function jsonError(status: number, code: string): Response {
  return Response.json({ error: { code } }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function encodeAws(part: string): string {
  return encodeURIComponent(part).replace(/[!'()*]/g, character =>
    '%' + character.charCodeAt(0).toString(16).toUpperCase());
}

function bytesBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

async function hmac(key: Uint8Array, value: string): Promise<Uint8Array> {
  const imported = await crypto.subtle.importKey('raw', bytesBuffer(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, encoder.encode(value)));
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export interface R2MediaRequest {
  initData: string;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
}

function parseMediaRequest(raw: unknown): R2MediaRequest | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  if (typeof input.initData !== 'string' || input.initData.length < 1 || input.initData.length > 4096
    || typeof input.storageKey !== 'string' || !DISCUSSION_MEDIA_KEY_PATTERN.test(input.storageKey)
    || typeof input.contentType !== 'string'
    || typeof input.sizeBytes !== 'number' || !Number.isSafeInteger(input.sizeBytes)
    || input.sizeBytes < 1 || input.sizeBytes > discussionMediaSizeLimit(input.contentType)) return null;
  return {
    initData: input.initData, storageKey: input.storageKey,
    contentType: input.contentType, sizeBytes: input.sizeBytes,
  };
}

/** Signs one write-once object; Content-Length, MIME and If-None-Match are bound to SigV4. */
export async function signDiscussionR2Put(input: Omit<R2MediaRequest, 'initData'>,
  env: Required<Pick<DiscussionR2MediaEnv, 'R2_ACCOUNT_ID' | 'R2_MEDIA_ACCESS_KEY_ID' | 'R2_MEDIA_SECRET_ACCESS_KEY'>>,
  now = new Date(),
): Promise<{ putUrl: string; expiresAt: number; storageKey: string }> {
  const date = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const day = date.slice(0, 8);
  const host = `${BUCKET}.${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const credentialScope = `${day}/auto/s3/aws4_request`;
  const signedHeaders = 'content-length;content-type;host;if-none-match';
  const parameters: [string, string][] = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Content-Sha256', 'UNSIGNED-PAYLOAD'],
    ['X-Amz-Credential', `${env.R2_MEDIA_ACCESS_KEY_ID}/${credentialScope}`],
    ['X-Amz-Date', date],
    ['X-Amz-Expires', String(EXPIRES_SECONDS)],
    ['X-Amz-SignedHeaders', signedHeaders],
  ];
  const query = parameters.sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeAws(key)}=${encodeAws(value)}`).join('&');
  const path = '/' + input.storageKey.split('/').map(encodeAws).join('/');
  const canonicalHeaders = `content-length:${input.sizeBytes}\ncontent-type:${input.contentType}\nhost:${host}\nif-none-match:*\n`;
  const canonicalRequest = `PUT\n${path}\n${query}\n${canonicalHeaders}\n${signedHeaders}\nUNSIGNED-PAYLOAD`;
  const toSign = `AWS4-HMAC-SHA256\n${date}\n${credentialScope}\n${await sha256Hex(canonicalRequest)}`;
  const keyDate = await hmac(encoder.encode('AWS4' + env.R2_MEDIA_SECRET_ACCESS_KEY), day);
  const keyRegion = await hmac(keyDate, 'auto');
  const keyService = await hmac(keyRegion, 's3');
  const signingKey = await hmac(keyService, 'aws4_request');
  const signature = hex(await hmac(signingKey, toSign));
  return {
    storageKey: input.storageKey,
    putUrl: `https://${host}${path}?${query}&X-Amz-Signature=${signature}`,
    expiresAt: now.getTime() + EXPIRES_SECONDS * 1000,
  };
}

export async function handleDiscussionR2MediaRoute(request: Request, env: DiscussionR2MediaEnv): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path !== '/api/discussion-media/sign' && path !== '/api/discussion-media/verify') {
    return jsonError(404, 'NOT_FOUND');
  }
  if (request.method !== 'POST') return jsonError(405, 'METHOD_NOT_ALLOWED');
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return jsonError(403, 'ORIGIN_FORBIDDEN');
  const length = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(length) && length > 8192) return jsonError(413, 'PAYLOAD_TOO_LARGE');
  let raw: unknown;
  try {
    const body = await request.text();
    if (body.length > 8192) return jsonError(413, 'PAYLOAD_TOO_LARGE');
    raw = JSON.parse(body);
  } catch {
    return jsonError(400, 'INVALID_JSON');
  }
  const input = parseMediaRequest(raw);
  if (!input) return jsonError(400, 'INVALID_MEDIA_REQUEST');
  try {
    await validateTelegramInitData(input.initData, env.TELEGRAM_BOT_TOKEN);
  } catch (error) {
    if (error instanceof TelegramAuthError) return jsonError(401, 'UNAUTHORIZED');
    throw error;
  }

  if (path.endsWith('/verify')) {
    const object = await env.R2_BINDING_MEZFIT.head(input.storageKey);
    if (!object) return jsonError(404, 'MEDIA_NOT_FOUND');
    if (object.size !== input.sizeBytes || object.httpMetadata?.contentType !== input.contentType) {
      return jsonError(409, 'MEDIA_MISMATCH');
    }
    return Response.json({ present: true }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const { R2_ACCOUNT_ID: accountId, R2_MEDIA_ACCESS_KEY_ID: accessKeyId,
    R2_MEDIA_SECRET_ACCESS_KEY: secretAccessKey } = env;
  if (!accountId || !/^[a-f0-9]{32}$/i.test(accountId)
    || !accessKeyId || !/^[A-Za-z0-9]{12,128}$/.test(accessKeyId) || !secretAccessKey) {
    return jsonError(503, 'R2_SIGNER_UNAVAILABLE');
  }
  const signed = await signDiscussionR2Put(input, {
    R2_ACCOUNT_ID: accountId,
    R2_MEDIA_ACCESS_KEY_ID: accessKeyId,
    R2_MEDIA_SECRET_ACCESS_KEY: secretAccessKey,
  });
  return Response.json(signed, { headers: { 'Cache-Control': 'no-store' } });
}
