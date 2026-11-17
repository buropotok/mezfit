import { UPLOAD_BUCKET, UPLOAD_KEY_PATTERN, validBackupMetadata } from './r2-upload';

const CREATE_ACTIONS = ['PutObject', 'CopyObject', 'CompleteMultipartUpload'];
export interface UploadEvent {
  account: string;
  bucket: string;
  action: string;
  object: { key: string; size: number; eTag: string };
  eventTime: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseUploadEvent(value: unknown, account: string): UploadEvent | null {
  if (!isRecord(value) || value.account !== account || value.bucket !== UPLOAD_BUCKET
    || typeof value.action !== 'string' || !CREATE_ACTIONS.includes(value.action)
    || typeof value.eventTime !== 'string' || !Number.isFinite(Date.parse(value.eventTime))
    || !isRecord(value.object)) return null;
  const { key, size, eTag } = value.object;
  if (typeof key !== 'string' || !UPLOAD_KEY_PATTERN.test(key) || typeof size !== 'number'
    || !Number.isSafeInteger(size) || size < 0 || typeof eTag !== 'string'
    || !/^[a-f0-9]{32}(-[1-9][0-9]*)?$/i.test(eTag)) return null;
  return { account, bucket: UPLOAD_BUCKET, action: value.action, object: { key, size, eTag },
    eventTime: new Date(value.eventTime).toISOString() };
}

interface EventBindings {
  CLOUDFLARE_ACCOUNT_ID: string;
  UPLOADS: R2Bucket;
  JOBS: D1Database;
}

async function registerUpload(env: EventBindings, event: UploadEvent): Promise<void> {
  const { key, size, eTag } = event.object;
  const object = await env.UPLOADS.head(key);
  const contentType = object?.httpMetadata?.contentType ?? '';
  const errorCode = !object ? 'OBJECT_MISSING'
    : object.size !== size || object.etag !== eTag ? 'OBJECT_MISMATCH'
      : validBackupMetadata(size, contentType) ? null : 'INVALID_BACKUP_METADATA';
  const now = new Date().toISOString();

  // A repeated delivery can update the delivery count, but cannot reset a job.
  // A stale/invalid notification for a different object cannot replace a registered upload.
  await env.JOBS.prepare(`
    INSERT INTO migration_jobs
      (id, object_key, object_etag, object_size, content_type, event_action, event_at,
       state, error_code, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(object_key) DO UPDATE SET
      deliveries = migration_jobs.deliveries + 1
    WHERE migration_jobs.object_etag = excluded.object_etag
      AND migration_jobs.event_at = excluded.event_at
      AND migration_jobs.event_action = excluded.event_action
  `).bind(key, key, eTag, size, errorCode ? null : contentType, event.action,
    event.eventTime, errorCode ? 'rejected' : 'uploaded', errorCode, now, now).run();
}

export async function consumeUploads(batch: MessageBatch<unknown>, env: EventBindings): Promise<void> {
  for (const message of batch.messages) {
    const event = parseUploadEvent(message.body, env.CLOUDFLARE_ACCOUNT_ID);
    if (!event) {
      console.warn('MIGRATION_INVALID_UPLOAD_EVENT');
      message.ack();
      continue;
    }
    try {
      await registerUpload(env, event);
      message.ack();
    } catch {
      console.error('MIGRATION_UPLOAD_REGISTRATION_FAILED');
      message.retry();
    }
  }
}
