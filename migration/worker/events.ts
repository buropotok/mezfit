import { SMOKE_ID_PATTERN, UPLOAD_BUCKET, UPLOAD_KEY_PATTERN, validBackupMetadata } from './r2-upload';

const CREATE_ACTIONS = ['PutObject', 'CopyObject', 'CompleteMultipartUpload'];
const ETAG_PATTERN = /^(?:"([a-f0-9]{32}(?:-[1-9][0-9]*)?)"|([a-f0-9]{32}(?:-[1-9][0-9]*)?))$/i;

export interface UploadEvent {
  account: string;
  bucket: string;
  action: string;
  object: { key: string; size: number; eTag: string };
  eventTime: string;
  smokeReplay?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseUploadEvent(value: unknown, account: string): UploadEvent | null {
  if (!isRecord(value) || value.account !== account || value.bucket !== UPLOAD_BUCKET
    || typeof value.action !== 'string' || !CREATE_ACTIONS.includes(value.action)
    || typeof value.eventTime !== 'string' || !Number.isFinite(Date.parse(value.eventTime))
    || !isRecord(value.object)) return null;
  const { key, size, eTag } = value.object;
  if (typeof key !== 'string' || !UPLOAD_KEY_PATTERN.test(key) || typeof size !== 'number'
    || !Number.isSafeInteger(size) || size < 0 || typeof eTag !== 'string') return null;
  const tag = ETAG_PATTERN.exec(eTag);
  if (!tag) return null;
  const marker = value.smokeReplay;
  if (marker !== undefined && (typeof marker !== 'string' || !SMOKE_ID_PATTERN.test(marker)
    || key !== 'smoke/' + marker || value.action !== 'PutObject')) return null;
  return { account, bucket: UPLOAD_BUCKET, action: value.action, object: { key, size, eTag: (tag[1] ?? tag[2]).toLowerCase() },
    eventTime: new Date(value.eventTime).toISOString(), ...(typeof marker === 'string' ? { smokeReplay: marker } : {}) };
}

interface EventBindings {
  CLOUDFLARE_ACCOUNT_ID: string;
  UPLOADS: R2Bucket;
  JOBS: D1Database;
}

async function registerUpload(env: EventBindings, event: UploadEvent): Promise<void> {
  const { key, size, eTag } = event.object;
  let object: R2Object | null;
  try {
    object = await env.UPLOADS.head(key);
  } catch {
    throw new Error('MIGRATION_R2_NOTIFICATION_HEAD_FAILED');
  }
  const contentType = object?.httpMetadata?.contentType ?? '';
  const errorCode = !object ? 'OBJECT_MISSING'
    : object.size !== size || object.etag.toLowerCase() !== eTag ? 'OBJECT_MISMATCH'
      : validBackupMetadata(size, contentType) ? null : 'INVALID_BACKUP_METADATA';
  const now = new Date().toISOString();

  // Preserve registered objects. A verified event may recover a rejected row left by
  // an earlier stale notification, but an unverified notification cannot downgrade it.
  const result = env.JOBS.prepare(
    "INSERT INTO migration_jobs (id, object_key, object_etag, object_size, content_type, event_action,"
    + " event_at, state, error_code, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?"
    + " WHERE ? IS NULL OR EXISTS (SELECT 1 FROM migration_jobs"
    + " WHERE object_key = ? AND state = 'uploaded' AND object_etag = ? AND object_size = ?"
    + " AND content_type = ? AND event_at = ? AND event_action = ?)"
    + " ON CONFLICT(object_key) DO UPDATE SET deliveries = migration_jobs.deliveries + 1"
    + " WHERE migration_jobs.object_etag = excluded.object_etag AND migration_jobs.object_size = excluded.object_size"
    + " AND migration_jobs.event_at = excluded.event_at AND migration_jobs.event_action = excluded.event_action",
  ).bind(key, key, eTag, size, errorCode ? null : contentType, event.action,
    event.eventTime, errorCode ? 'rejected' : 'uploaded', errorCode, now, now,
    event.smokeReplay ?? null, key, eTag, size, contentType, event.eventTime, event.action);
  if (event.smokeReplay) {
    if (errorCode) {
      console.warn('MIGRATION_SMOKE_REPLAY_OBJECT_INVALID', errorCode);
      return;
    }
    // The replay goes through the normal write with an exact existing-job guard.
    // The receipt is written in the same D1 transaction and is unique per marker.
    const receipt = env.JOBS.prepare(
      'INSERT OR IGNORE INTO migration_smoke_replays (replay_id, object_key, observed_at)'
      + ' SELECT ?, object_key, ? FROM migration_jobs'
      + " WHERE object_key = ? AND state = 'uploaded' AND object_etag = ? AND object_size = ?"
      + ' AND content_type = ? AND event_at = ? AND event_action = ?',
    ).bind(event.smokeReplay, now, key, eTag, size, contentType, event.eventTime, event.action);
    const replay = await env.JOBS.batch([result, receipt]);
    if (replay.some(statement => !statement.success)) throw new Error('MIGRATION_D1_RECEIPT_WRITE_FAILED');
    return;
  }
  if (errorCode) {
    if (!(await result.run()).success) throw new Error('MIGRATION_D1_JOB_WRITE_FAILED');
    return;
  }
  const promote = env.JOBS.prepare(
    "UPDATE migration_jobs SET object_etag = ?, object_size = ?, content_type = ?, event_action = ?,"
    + " event_at = ?, state = 'uploaded', error_code = NULL, updated_at = ? WHERE object_key = ? AND state = 'rejected'",
  ).bind(eTag, size, contentType, event.action, event.eventTime, now, key);
  const results = await env.JOBS.batch([result, promote]);
  if (results.some(statement => !statement.success)) throw new Error('MIGRATION_D1_JOB_WRITE_FAILED');
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
    } catch (error) {
      const stage = error instanceof Error && error.message === 'MIGRATION_R2_NOTIFICATION_HEAD_FAILED' ? 'R2_HEAD' : 'D1_WRITE';
      console.error('MIGRATION_UPLOAD_REGISTRATION_FAILED', stage, message.attempts);
      message.retry();
    }
  }
}
