import type { Trace } from '../trace.mjs';

// SigV4 implementation copied from worker/lib/discussion-media-r2.ts.
export const UPLOAD_BUCKET = 'mezfit-migration-uploads';
export const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
export const UPLOAD_TTL_SECONDS = 600;
const encoder = new TextEncoder();
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
export const SMOKE_ID_PATTERN = new RegExp('^' + UUID + '$');
export const UPLOAD_KEY_PATTERN = new RegExp('^(uploads|smoke)/' + UUID + '$');
export const SMOKE_OBJECT_PATTERN = new RegExp('^smoke/' + UUID + '(/(mime|length|conditional|expired))?$');
const BACKUP_CONTENT_TYPES = new Set(['application/octet-stream', 'application/zip', 'application/gzip',
  'application/x-sqlite3', 'application/vnd.sqlite3']);

export interface UploadCredentials {
  CLOUDFLARE_ACCOUNT_ID: string;
  MIGRATION_R2_ACCESS_KEY_ID: string;
  MIGRATION_R2_SECRET_ACCESS_KEY: string;
}

export interface BackupMetadata {
  sizeBytes: number;
  contentType: string;
}

export function validBackupMetadata(sizeBytes: number, contentType: string): boolean {
  return Number.isSafeInteger(sizeBytes) && sizeBytes > 0 && sizeBytes <= MAX_BACKUP_BYTES
    && BACKUP_CONTENT_TYPES.has(contentType);
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

// Call after authorization at the internal API boundary. Never put user IDs or filenames in keys.
export async function createBackupUpload(metadata: BackupMetadata, credentials: UploadCredentials) {
  return signBackupPut('uploads/' + crypto.randomUUID(), metadata, credentials);
}

/** Signs one write-once object; Content-Length, MIME and If-None-Match are bound to SigV4. */
export async function signBackupPut(storageKey: string, metadata: BackupMetadata,
  env: UploadCredentials,
  now = new Date(),
  emit?: Trace,
): Promise<{ putUrl: string; expiresAt: number; storageKey: string }> {
  const validKey = UPLOAD_KEY_PATTERN.test(storageKey) || SMOKE_OBJECT_PATTERN.test(storageKey);
  const validMetadata = validBackupMetadata(metadata.sizeBytes, metadata.contentType);
  const started = Date.now();
  emit?.('r2', 'signed-url', 'R2_SIGV4_SIGNING', 'STARTED', { expected: 'signed-put-capability' });
  emit?.('r2', 'signing-key-format', 'R2_OBJECT_KEY_CHECKED', validKey ? 'OK' : 'FAILED', {
    expected: 'generated-backup-key', actual: validKey ? 'valid' : 'invalid', error_code: validKey ? undefined : 'INVALID_BACKUP_UPLOAD',
  });
  emit?.('r2', 'signing-metadata', 'R2_SIGNATURE_METADATA_CHECKED', validMetadata ? 'OK' : 'FAILED', {
    expected: 'supported-backup-metadata', actual: validMetadata ? 'valid' : 'invalid',
    error_code: validMetadata ? undefined : 'INVALID_BACKUP_UPLOAD', details: { size: metadata.sizeBytes, mime: metadata.contentType },
  });
  if (!validKey || !validMetadata) {
    throw new Error('INVALID_BACKUP_UPLOAD');
  }
  const hasCredentials = /^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID)
    && /^[a-f0-9]{32}$/.test(env.MIGRATION_R2_ACCESS_KEY_ID)
    && /^[a-f0-9]{64}$/.test(env.MIGRATION_R2_SECRET_ACCESS_KEY);
  emit?.('r2', 'signing-credentials', 'R2_CREDENTIALS_CHECKED', hasCredentials ? 'OK' : 'FAILED', {
    expected: 'configured-r2-credentials', actual: hasCredentials ? 'present' : 'missing-or-invalid',
    error_code: hasCredentials ? undefined : 'MIGRATION_R2_SIGNER_UNAVAILABLE', details: { has_credentials: hasCredentials },
  });
  if (!hasCredentials) {
    throw new Error('MIGRATION_R2_SIGNER_UNAVAILABLE');
  }
  const date = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const day = date.slice(0, 8);
  const host = `${UPLOAD_BUCKET}.${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const credentialScope = `${day}/auto/s3/aws4_request`;
  const signedHeaders = 'content-length;content-type;host;if-none-match';
  const parameters: [string, string][] = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Content-Sha256', 'UNSIGNED-PAYLOAD'],
    ['X-Amz-Credential', `${env.MIGRATION_R2_ACCESS_KEY_ID}/${credentialScope}`],
    ['X-Amz-Date', date],
    ['X-Amz-Expires', String(UPLOAD_TTL_SECONDS)],
    ['X-Amz-SignedHeaders', signedHeaders],
  ];
  const query = parameters.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `${encodeAws(key)}=${encodeAws(value)}`).join('&');
  const path = '/' + storageKey.split('/').map(encodeAws).join('/');
  const canonicalHeaders = `content-length:${metadata.sizeBytes}\ncontent-type:${metadata.contentType}\nhost:${host}\nif-none-match:*\n`;
  const canonicalRequest = `PUT\n${path}\n${query}\n${canonicalHeaders}\n${signedHeaders}\nUNSIGNED-PAYLOAD`;
  emit?.('r2', 'canonical-request', 'R2_CANONICAL_REQUEST_BUILT', 'OK', { actual: 'canonical-put-request', details: { method: 'PUT' } });
  emit?.('r2', 'signed-headers', 'R2_SIGNED_HEADERS_BOUND', 'OK', { actual: 'length-type-host-conditional' });
  emit?.('r2', 'signature-ttl', 'R2_SIGNATURE_TTL', 'OK', { details: { ttl_seconds: UPLOAD_TTL_SECONDS } });
  const toSign = `AWS4-HMAC-SHA256\n${date}\n${credentialScope}\n${await sha256Hex(canonicalRequest)}`;
  const keyDate = await hmac(encoder.encode('AWS4' + env.MIGRATION_R2_SECRET_ACCESS_KEY), day);
  const keyRegion = await hmac(keyDate, 'auto');
  const keyService = await hmac(keyRegion, 's3');
  const signingKey = await hmac(keyService, 'aws4_request');
  const signature = hex(await hmac(signingKey, toSign));
  emit?.('r2', 'signed-url', 'R2_SIGV4_SIGNING', 'OK', { actual: 'signed-put-capability', duration_ms: Date.now() - started });
  return {
    storageKey,
    putUrl: `https://${host}${path}?${query}&X-Amz-Signature=${signature}`,
    expiresAt: Math.floor(now.getTime() / 1000) * 1000 + UPLOAD_TTL_SECONDS * 1000,
  };
}

export async function verifyBackupUpload(bucket: R2Bucket, key: string, metadata: BackupMetadata): Promise<boolean> {
  if (!UPLOAD_KEY_PATTERN.test(key) || !validBackupMetadata(metadata.sizeBytes, metadata.contentType)) return false;
  return backupObjectMatches(await bucket.head(key), metadata);
}

export function backupObjectMatches(object: R2Object | null, metadata: BackupMetadata): boolean {
  return object?.size === metadata.sizeBytes && object.httpMetadata?.contentType === metadata.contentType;
}
