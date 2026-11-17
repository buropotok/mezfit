import { classifyTraceError, smokeTraceId, traceWriter, type Trace } from '../trace.mjs';
import { isTraceObject, observed, workerTrace, type WorkerVersion } from './trace';
import { SMOKE_ID_PATTERN, SMOKE_OBJECT_PATTERN, UPLOAD_BUCKET, UPLOAD_KEY_PATTERN, validBackupMetadata } from './r2-upload';

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

export function parseUploadEvent(value: unknown, account: string, emit?: Trace): UploadEvent | null {
  const shape = isRecord(value) ? value : null;
  const object = isRecord(shape?.object) ? shape.object : null;
  emit?.('consumer', 'event-shape', 'QUEUE_EVENT_SHAPE', 'OK', { actual: shape ? 'object' : typeof value === 'string' ? 'serialized-envelope' : 'invalid-envelope',
    details: { has_account: !!shape && Object.hasOwn(shape, 'account'), has_bucket: !!shape && Object.hasOwn(shape, 'bucket'),
      has_action: !!shape && Object.hasOwn(shape, 'action'), has_object: !!object,
      has_event_time: !!shape && Object.hasOwn(shape, 'eventTime'), has_marker: !!shape && Object.hasOwn(shape, 'smokeReplay') } });
  const tag = typeof object?.eTag === 'string' ? ETAG_PATTERN.exec(object.eTag) : null;
  const marker = shape?.smokeReplay;
  const key = object?.key;
  const size = object?.size;
  const action = shape?.action;
  const eventTime = shape?.eventTime;
  const checks: [string, boolean, string][] = [
    ['envelope', !!shape, 'object'],
    ['account', shape?.account === account, 'migration-account'],
    ['bucket', shape?.bucket === UPLOAD_BUCKET, 'migration-bucket'],
    ['action', typeof action === 'string' && CREATE_ACTIONS.includes(action), 'object-create-action'],
    ['object', !!object, 'object'],
    ['object.key', typeof key === 'string' && UPLOAD_KEY_PATTERN.test(key), 'generated-backup-key'],
    ['object.size', typeof size === 'number' && Number.isSafeInteger(size) && size >= 0, 'nonnegative-integer'],
    ['object.eTag', !!tag, 'r2-etag'],
    ['eventTime', typeof eventTime === 'string' && Number.isFinite(Date.parse(eventTime)), 'r2-event-timestamp'],
    ['smokeReplay', marker === undefined || (typeof marker === 'string' && SMOKE_ID_PATTERN.test(marker)
      && key === 'smoke/' + marker && action === 'PutObject'), 'absent-or-matching-smoke-marker'],
  ];
  for (const [field, valid, expected] of checks) {
    emit?.('consumer', 'event-validation', 'QUEUE_EVENT_FIELD_CHECKED', valid ? 'OK' : 'FAILED', {
      expected, actual: valid ? 'valid' : 'missing-or-invalid', error_code: valid ? undefined : 'QUEUE_EVENT_FIELD_INVALID',
      details: { field },
    });
  }
  const rejected = checks.find(([, valid]) => !valid);
  if (rejected) {
    emit?.('consumer', 'event-validation', 'QUEUE_EVENT_REJECTED', 'FAILED', {
      error_code: 'QUEUE_EVENT_INVALID', expected: 'valid-upload-event', actual: 'invalid-event', details: { field: rejected[0] },
    });
    return null;
  }
  if (typeof key !== 'string' || typeof size !== 'number' || typeof action !== 'string'
    || typeof eventTime !== 'string' || !tag) return null;
  emit?.('consumer', 'event-validation', 'QUEUE_EVENT_VALIDATED', 'OK', {
    actual: 'valid-upload-event', details: { action, size, replay: typeof marker === 'string',
      delivery_ms: Math.max(0, Date.now() - Date.parse(eventTime)) },
  });
  return { account, bucket: UPLOAD_BUCKET, action, object: { key, size, eTag: (tag[1] ?? tag[2]).toLowerCase() },
    eventTime: new Date(eventTime).toISOString(), ...(typeof marker === 'string' ? { smokeReplay: marker } : {}) };
}

interface EventBindings {
  CLOUDFLARE_ACCOUNT_ID: string;
  UPLOADS: R2Bucket;
  JOBS: D1Database;
  MIGRATION_VERSION?: WorkerVersion;
}

async function registerUpload(env: EventBindings, event: UploadEvent, emit: Trace): Promise<void> {
  const { key, size, eTag } = event.object;
  let object: R2Object | null;
  try {
    object = await observed(emit, 'r2', 'consumer-head', 'CONSUMER_R2_HEAD', { expected: 'head-result' },
      () => env.UPLOADS.head(key), value => ({ actual: value ? 'object-found' : 'object-missing',
        details: { exists: !!value, size: value?.size, mime: value?.httpMetadata?.contentType, etag_matches: value?.etag.toLowerCase() === eTag } }));
  } catch {
    throw new Error('MIGRATION_R2_NOTIFICATION_HEAD_FAILED');
  }
  const contentType = object?.httpMetadata?.contentType ?? '';
  const errorCode = !object ? 'OBJECT_MISSING'
    : object.size !== size || object.etag.toLowerCase() !== eTag ? 'OBJECT_MISMATCH'
      : validBackupMetadata(size, contentType) ? null : 'INVALID_BACKUP_METADATA';
  emit('consumer', 'object-metadata', 'QUEUE_OBJECT_METADATA_COMPARED', errorCode ? 'FAILED' : 'OK', {
    expected: 'verified-object-metadata', actual: errorCode ? 'rejected' : 'uploaded', error_code: errorCode ?? undefined,
    details: { state: errorCode ? 'rejected' : 'uploaded', expected_size: size, size: object?.size,
      size_matches: object?.size === size, mime: contentType, mime_matches: validBackupMetadata(size, contentType),
      etag_matches: object?.etag.toLowerCase() === eTag },
  });
  const now = new Date().toISOString();
  const insertDetails = { table: 'migration_jobs', sql: 'INSERT' };
  emit('d1', 'job-insert-prepare', 'D1_INSERT_PREPARE', 'STARTED', { expected: 'prepared', details: insertDetails });

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
  emit('d1', 'job-insert-prepare', 'D1_INSERT_PREPARE', 'OK', { actual: 'prepared', details: insertDetails });
  const writeStarted = Date.now();
  if (event.smokeReplay) {
    if (errorCode) {
      emit('d1', 'replay-receipt', 'D1_REPLAY_RECEIPT', 'SKIPPED', {
        expected: 'verified-replay-object', actual: 'rejected', error_code: errorCode,
      });
      return;
    }
    // The replay goes through the normal write with an exact existing-job guard.
    // The receipt is written in the same D1 transaction and is unique per marker.
    emit('d1', 'job-insert', 'D1_JOB_INSERT', 'STARTED', { expected: 'matching-job', details: insertDetails });
    emit('d1', 'replay-receipt', 'D1_REPLAY_RECEIPT', 'STARTED', {
      expected: 'single-receipt', details: { table: 'migration_smoke_replays', sql: 'INSERT' },
    });
    const receipt = env.JOBS.prepare(
      'INSERT OR IGNORE INTO migration_smoke_replays (replay_id, object_key, observed_at)'
      + ' SELECT ?, object_key, ? FROM migration_jobs'
      + " WHERE object_key = ? AND state = 'uploaded' AND object_etag = ? AND object_size = ?"
      + ' AND content_type = ? AND event_at = ? AND event_action = ?',
    ).bind(event.smokeReplay, now, key, eTag, size, contentType, event.eventTime, event.action);
    const replay = await observed(emit, 'd1', 'replay-batch', 'D1_REPLAY_BATCH',
      { expected: 'committed', details: { sql: 'BATCH' } }, () => env.JOBS.batch([result, receipt]),
      statements => ({ actual: statements.every(item => item.success) ? 'committed' : 'rejected',
        error_code: statements.every(item => item.success) ? undefined : 'D1_REPLAY_BATCH_FAILED' }));
    reportStatement(emit, 'job-insert', 'D1_JOB_INSERT', replay[0], insertDetails, writeStarted);
    reportStatement(emit, 'replay-receipt', 'D1_REPLAY_RECEIPT', replay[1],
      { table: 'migration_smoke_replays', sql: 'INSERT' }, writeStarted);
    if (replay.some(statement => !statement.success)) throw new Error('MIGRATION_D1_RECEIPT_WRITE_FAILED');
    return;
  }
  if (errorCode) {
    const rejected = await observed(emit, 'd1', 'job-insert', 'D1_JOB_INSERT',
      { expected: 'committed', details: insertDetails }, () => result.run(),
      item => ({ actual: item.success ? 'committed' : 'rejected', error_code: item.success ? undefined : 'D1_JOB_INSERT_FAILED',
        details: { ...insertDetails, affected_rows: item.meta?.changes } }));
    if (!rejected.success) throw new Error('MIGRATION_D1_JOB_WRITE_FAILED');
    return;
  }
  const promote = env.JOBS.prepare(
    "UPDATE migration_jobs SET object_etag = ?, object_size = ?, content_type = ?, event_action = ?,"
    + " event_at = ?, state = 'uploaded', error_code = NULL, updated_at = ? WHERE object_key = ? AND state = 'rejected'",
  ).bind(eTag, size, contentType, event.action, event.eventTime, now, key);
  emit('d1', 'job-insert', 'D1_JOB_INSERT', 'STARTED', { expected: 'committed', details: insertDetails });
  const promoteDetails = { table: 'migration_jobs', sql: 'UPDATE' };
  emit('d1', 'job-promote', 'D1_JOB_PROMOTE', 'STARTED', { expected: 'promoted-or-already-current', details: promoteDetails });
  const results = await observed(emit, 'd1', 'job-batch', 'D1_JOB_BATCH', { expected: 'committed', details: { sql: 'BATCH' } },
    () => env.JOBS.batch([result, promote]), statements => ({ actual: statements.every(item => item.success) ? 'committed' : 'rejected',
      error_code: statements.every(item => item.success) ? undefined : 'D1_JOB_BATCH_FAILED' }));
  reportStatement(emit, 'job-insert', 'D1_JOB_INSERT', results[0], insertDetails, writeStarted);
  reportStatement(emit, 'job-promote', 'D1_JOB_PROMOTE', results[1], promoteDetails, writeStarted);
  if (results.some(statement => !statement.success)) throw new Error('MIGRATION_D1_JOB_WRITE_FAILED');
}

function reportStatement(emit: Trace, stage: string, event: string, result: D1Result, details: Record<string, string>, start: number) {
  emit('d1', stage, event, result?.success ? 'OK' : 'FAILED', {
    expected: 'committed', actual: result?.success ? 'committed' : 'rejected',
    error_code: result?.success ? undefined : event + '_FAILED',
    duration_ms: Date.now() - start, details: { ...details, affected_rows: result?.meta?.changes },
  });
  if (event === 'D1_JOB_INSERT') {
    emit('d1', 'job-on-conflict', 'D1_UPSERT_BRANCH', 'NOT_OBSERVED', {
      expected: 'insert-or-idempotent-update', actual: 'branch-not-reported-by-d1', details: { affected_rows: result?.meta?.changes },
    });
  }
}

function correlateSmokeKey(body: unknown): string | null {
  // A serialized envelope can still be correlated for diagnosis. Validation
  // retains the provider contract and rejects it as an invalid message.
  let value = body;
  if (typeof body === 'string' && body.length <= 8192) {
    try { value = JSON.parse(body); } catch { return null; }
  }
  return isRecord(value) && isRecord(value.object) ? smokeTraceId(value.object.key) : null;
}

export async function consumeUploads(batch: MessageBatch<unknown>, env: EventBindings): Promise<void> {
  const start = Date.now();
  const batchLog = traceWriter({ trace_id: crypto.randomUUID(), worker_version: env.MIGRATION_VERSION?.id });
  batchLog('consumer', 'queue-invocation', 'QUEUE_CONSUMER_INVOKED', 'STARTED');
  batchLog('consumer', 'queue-batch', 'QUEUE_BATCH_RECEIVED', 'OK', { details: { batch_size: batch.messages.length } });
  try {
    for (const message of batch.messages) {
      const body = isRecord(message.body) ? message.body : null;
      const object = isRecord(body?.object) ? body.object : null;
      const traceId = correlateSmokeKey(message.body);
      const mirror = workerTrace(env.UPLOADS, { trace_id: traceId ?? crypto.randomUUID(), instance_id: traceId,
        worker_version: env.MIGRATION_VERSION?.id, attempt: message.attempts });
      const emit = mirror.emit;
      const received = Date.now();
      emit('consumer', 'queue-invocation', 'QUEUE_CONSUMER_INVOKED', 'OK', { actual: 'queue-handler-running' });
      emit('consumer', 'queue-batch', 'QUEUE_BATCH_RECEIVED', 'OK', { details: { batch_size: batch.messages.length } });
      emit('consumer', 'queue-message', 'QUEUE_MESSAGE_RECEIVED', 'OK', { expected: 'queue-delivery', actual: 'message-received',
        details: { message_id: message.id, timestamp_ms: message.timestamp?.getTime(), batch_size: batch.messages.length } });
      let decision = 'processed';
      let retry = false;
      try {
        if (isTraceObject(object?.key)) {
          decision = 'trace-object-notification';
          emit('consumer', 'event-validation', 'QUEUE_TRACE_OBJECT_SKIPPED', 'SKIPPED', { actual: decision });
        } else if (typeof object?.key === 'string' && SMOKE_OBJECT_PATTERN.test(object.key) && object.key.endsWith('/expired')) {
          decision = 'expiry-control-object';
          emit('consumer', 'event-validation', 'QUEUE_EXPIRY_CONTROL_SKIPPED', 'SKIPPED', { actual: decision });
        } else {
          const event = parseUploadEvent(message.body, env.CLOUDFLARE_ACCOUNT_ID, emit);
          if (!event) decision = 'invalid-event';
          else {
            await registerUpload(env, event, emit);
            emit('consumer', 'job-result', 'QUEUE_JOB_RESULT', 'OK', { actual: 'database-operation-completed',
              details: { replay: !!event.smokeReplay } });
          }
        }
      } catch (error) {
        retry = true;
        decision = error instanceof Error && error.message === 'MIGRATION_R2_NOTIFICATION_HEAD_FAILED' ? 'r2-head-error' : 'd1-write-error';
        emit('consumer', 'job-result', 'QUEUE_JOB_RESULT', 'FAILED', { expected: 'processed', actual: decision,
          error_code: 'MIGRATION_UPLOAD_REGISTRATION_FAILED', details: { classification: classifyTraceError(error) } });
      } finally {
        const event = retry ? 'QUEUE_MESSAGE_RETRY' : 'QUEUE_MESSAGE_ACK';
        emit('consumer', 'queue-decision', event, retry ? 'RETRY' : 'STARTED', {
          expected: retry ? 'retry-requested' : 'acknowledged', actual: decision,
        });
        try {
          if (retry) message.retry();
          else message.ack();
          emit('consumer', 'queue-decision', event, 'OK', { actual: retry ? 'retry-requested' : 'acknowledged' });
        } catch (error) {
          emit('consumer', 'queue-decision', event, 'FAILED', {
            error_code: event + '_FAILED', actual: 'queue-decision-rejected', details: { classification: classifyTraceError(error) },
          });
          throw error;
        } finally {
          emit('consumer', 'queue-message', 'QUEUE_MESSAGE_FINISHED', retry ? 'RETRY' : 'OK', {
            duration_ms: Date.now() - received, actual: decision,
          });
          await mirror.flush();
        }
      }
    }
    batchLog('consumer', 'queue-invocation', 'QUEUE_BATCH_FINISHED', 'OK', {
      duration_ms: Date.now() - start, details: { batch_size: batch.messages.length },
    });
  } catch (error) {
    batchLog('consumer', 'queue-invocation', 'QUEUE_BATCH_FINISHED', 'FAILED', {
      duration_ms: Date.now() - start, error_code: 'QUEUE_BATCH_INTERRUPTED', details: { classification: classifyTraceError(error) },
    });
    throw error;
  }
}
