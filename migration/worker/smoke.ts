import { classifyTraceError, TRACE_PREFIX, traceStepName, type Trace, type TraceContext } from '../trace.mjs';
import { isTraceObject, observed, workerTrace, type WorkerVersion } from './trace';
import type { WorkflowStep } from 'cloudflare:workers';
import type { UploadEvent } from './events';
import { SMOKE_OBJECT_PATTERN, UPLOAD_BUCKET, UPLOAD_TTL_SECONDS, signBackupPut, signSmokeExpiryPut, SMOKE_EXPIRY_TTL_SECONDS,
  backupObjectMatches, type UploadCredentials } from './r2-upload';
import { anonymousRejected, expiryNeedsControl, expiryRejected, readS3Reply, signatureRejected, writeOnceRejected,
  type S3Reply } from './smoke-http';

export interface SmokeBindings extends UploadCredentials {
  UPLOADS: R2Bucket;
  JOBS: D1Database;
  EVENTS: Queue<UploadEvent>;
  MIGRATION_VERSION?: WorkerVersion;
}

type SmokeJob = {
  id: string;
  state: string;
  object_etag: string;
  object_size: number;
  content_type: string;
  event_at: string;
  event_action: string;
  error_code: string | null;
  created_at: string;
  updated_at: string;
};

const CONTENT_TYPE = 'application/octet-stream';
const BODY = new TextEncoder().encode('mezfit-migration-smoke\n');
const BACKUP = { sizeBytes: BODY.byteLength, contentType: CONTENT_TYPE };
const ETAG = 'c2c4344304438b96fbd9a2383b658334';
const PROBES = ['mime', 'length', 'conditional'] as const;
const EXPIRY_CLOCK_MARGIN_MS = 3000;
const smokeProbeKeys = (key: string) => [...PROBES, 'expired'].map(kind => key + '/' + kind);
const READ = { retries: { limit: 2, delay: '2 seconds', backoff: 'exponential' }, timeout: '15 seconds' } as const;
const WRITE = { retries: { limit: 2, delay: '3 seconds', backoff: 'exponential' }, timeout: '20 seconds' } as const;
const WAIT = { retries: { limit: 12, delay: '5 seconds', backoff: 'constant' }, timeout: '10 seconds' } as const;
const PREVIOUS_RUN_AGE_MS = 24 * 60 * 60 * 1000;

export class SmokeFailure extends Error {
  constructor(code: string, category: string, expected: string, actual: string, readonly retryable = false) {
    super([code, category, expected, actual].join('|'));
  }
}

function httpFailure(code: string, expected: string, reply: S3Reply): SmokeFailure {
  const transient = reply.status === 429 || reply.status >= 500
    || (reply.status === 409 && reply.code === 'ConditionalRequestConflict');
  const category = transient ? 'transient' : [401, 403].includes(reply.status) ? 'authentication' : 'http';
  return new SmokeFailure(code, category, expected, 'http-' + reply.status + '-' + reply.code, transient);
}

async function request(url: string, body?: Uint8Array<ArrayBuffer>, type = CONTENT_TYPE, conditional = true, emit?: Trace): Promise<S3Reply> {
  const method = body ? 'PUT' : 'GET';
  const start = Date.now();
  emit?.('r2', 'http-prepare', 'R2_HTTP_PREPARED', 'OK', { details: { method, size: body?.byteLength, mime: type, present: conditional } });
  emit?.('r2', 'http-request', 'R2_HTTP_REQUEST', 'STARTED', { expected: 's3-response', details: { method, timeout_ms: 8000 } });
  try {
    // Workers sets Content-Length from the fixed-size TypedArray. The signed value is never set manually.
    const response = await fetch(url, {
      method: body ? 'PUT' : 'GET', redirect: 'manual', signal: AbortSignal.timeout(8000),
      ...(body ? { body, headers: { 'Content-Type': type, ...(conditional ? { 'If-None-Match': '*' } : {}) } } : {}),
    });
    const reply = await readS3Reply(response);
    emit?.('r2', 'http-request', 'R2_HTTP_REQUEST', 'OK', { actual: 'http-' + reply.status + '-' + reply.code,
      duration_ms: Date.now() - start, details: { method, http_status: reply.status,
        s3_content_type: reply.contentType, s3_body_format: reply.bodyFormat, s3_code_present: reply.codePresent } });
    return reply;
  } catch (error) {
    emit?.('r2', 'http-request', 'R2_HTTP_REQUEST', 'FAILED', { expected: 's3-response', actual: 'fetch-failed',
      error_code: 'SMOKE_R2_TRANSPORT', duration_ms: Date.now() - start, details: { method, classification: classifyTraceError(error) } });
    throw new SmokeFailure('SMOKE_R2_TRANSPORT', 'transient', 's3-response', 'network-or-timeout', true);
  }
}

async function sign(key: string, env: SmokeBindings, now?: Date, emit?: Trace): Promise<string> {
  try {
    const signed = await signBackupPut(key, BACKUP, env, now, emit);
    if (new URL(signed.putUrl).searchParams.get('X-Amz-Expires') !== String(UPLOAD_TTL_SECONDS)) {
      throw new Error('wrong-ttl');
    }
    return signed.putUrl;
  } catch (error) {
    emit?.('r2', 'signed-url', 'R2_SIGV4_SIGNING', 'FAILED', { expected: 'signed-put-capability', actual: 'signer-unavailable',
      error_code: 'SMOKE_SIGNER_FAILED', details: { classification: classifyTraceError(error) } });
    throw new SmokeFailure('SMOKE_SIGNER_FAILED', 'configuration', 'configured-signer-and-valid-ttl', 'signer-unavailable');
  }
}

async function head(env: SmokeBindings, key: string, emit?: Trace): Promise<R2Object | null> {
  try {
    return await observed(emit, 'r2', 'smoke-head', 'SMOKE_R2_HEAD', { expected: 'head-result' },
      () => env.UPLOADS.head(key), value => ({ actual: value ? 'object-found' : 'object-missing',
        details: { exists: !!value, size: value?.size, mime: value?.httpMetadata?.contentType,
          size_matches: value?.size === BACKUP.sizeBytes, mime_matches: value?.httpMetadata?.contentType === CONTENT_TYPE,
          etag_matches: value?.etag.toLowerCase() === ETAG } }));
  } catch {
    throw new SmokeFailure('SMOKE_R2_HEAD_FAILED', 'storage', 'r2-head-response', 'r2-head-rejected', true);
  }
}

function matchesBackup(object: R2Object | null): boolean {
  return backupObjectMatches(object, BACKUP) && object?.etag.toLowerCase() === ETAG;
}

async function putBackup(env: SmokeBindings, key: string, emit?: Trace): Promise<void> {
  const existing = await head(env, key, emit);
  if (existing) {
    if (matchesBackup(existing)) {
      emit?.('r2', 'signed-upload', 'R2_PUT_RECONCILED', 'OK', { actual: 'existing-matching-object' });
      return;
    } // Reconcile a previous attempt that committed before losing its reply.
    throw new SmokeFailure('SMOKE_UPLOAD_KEY_OCCUPIED', 'integrity', 'empty-or-own-backup', 'unexpected-object');
  }
  const reply = await request(await sign(key, env, undefined, emit), BODY, CONTENT_TYPE, true, emit);
  if (reply.status === 200) {
    emit?.('r2', 'signed-upload', 'R2_PUT_COMMITTED', 'OK', { actual: 'http-200', details: { http_status: 200, size: BACKUP.sizeBytes } });
    return;
  }
  if (writeOnceRejected(reply) && matchesBackup(await head(env, key, emit))) return;
  throw httpFailure('SMOKE_SIGNED_PUT_FAILED', 'http-200', reply);
}

async function negativePut(env: SmokeBindings, key: string, kind: typeof PROBES[number], emit?: Trace): Promise<void> {
  const url = await sign(key, env, undefined, emit);
  const bytes = kind === 'length' ? new Uint8Array(BODY.byteLength + 1) : BODY;
  const reply = await request(url, bytes, kind === 'mime' ? 'application/zip' : CONTENT_TYPE, kind !== 'conditional', emit);
  if (await head(env, key, emit)) {
    throw new SmokeFailure('SMOKE_BAD_PUT_CREATED_OBJECT', 'integrity', 'probe-object-absent', 'probe-object-present');
  }
  if (!signatureRejected(reply, kind === 'conditional')) {
    throw httpFailure('SMOKE_INVALID_' + kind.toUpperCase() + '_ACCEPTANCE', 'signature-rejection', reply);
  }
}

type ExpiryControl = { issuedAt: number; expiresAt: number; fingerprint: string };

async function expiryFingerprint(url: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function primeExpiry(env: SmokeBindings, key: string, emit?: Trace): Promise<ExpiryControl> {
  const existing = await head(env, key, emit);
  if (existing) {
    if (!matchesBackup(existing)) {
      throw new SmokeFailure('SMOKE_EXPIRY_CONTROL_MISMATCH', 'integrity', 'isolated-smoke-object', 'unexpected-object');
    }
    await deleteSmokeObjects(env, [key], emit);
  }
  const issuedAt = Date.now();
  const signed = await signSmokeExpiryPut(key, BACKUP, env, new Date(issuedAt), emit);
  if (new URL(signed.putUrl).searchParams.get('X-Amz-Expires') !== String(SMOKE_EXPIRY_TTL_SECONDS)) {
    throw new SmokeFailure('SMOKE_EXPIRY_CONTROL_MISMATCH', 'integrity', 'short-expiry', 'unexpected-ttl');
  }
  const reply = await request(signed.putUrl, BODY, CONTENT_TYPE, true, emit);
  if (reply.status !== 200) throw httpFailure('SMOKE_EXPIRY_CONTROL_PUT_FAILED', 'http-200', reply);
  if (Date.now() >= signed.expiresAt || !matchesBackup(await head(env, key, emit))) {
    throw new SmokeFailure('SMOKE_EXPIRY_CONTROL_MISMATCH', 'integrity', 'valid-put-before-expiry', 'baseline-unverified');
  }
  await deleteSmokeObjects(env, [key], emit);
  if (await head(env, key, emit)) {
    throw new SmokeFailure('SMOKE_EXPIRY_CONTROL_MISMATCH', 'integrity', 'empty-probe-key', 'probe-object-present');
  }
  // Workflow state contains a timestamp and fingerprint only. Re-signing later
  // must yield the exact capability exercised before expiry.
  return { issuedAt, expiresAt: signed.expiresAt, fingerprint: await expiryFingerprint(signed.putUrl) };
}

async function rejectExpired(env: SmokeBindings, key: string, control: ExpiryControl, emit?: Trace): Promise<void> {
  const expired = await signSmokeExpiryPut(key, BACKUP, env, new Date(control.issuedAt), emit);
  if (expired.expiresAt !== control.expiresAt || Date.now() < control.expiresAt
    || await expiryFingerprint(expired.putUrl) !== control.fingerprint) {
    throw new SmokeFailure('SMOKE_EXPIRY_CONTROL_MISMATCH', 'integrity', 'same-url-after-expiry', 'expiry-control-unverified');
  }
  if (await head(env, key, emit)) {
    throw new SmokeFailure('SMOKE_EXPIRY_CONTROL_MISMATCH', 'integrity', 'empty-probe-key', 'probe-object-present');
  }
  const reply = await request(expired.putUrl, BODY, CONTENT_TYPE, true, emit);
  if (await head(env, key, emit)) {
    throw new SmokeFailure('SMOKE_BAD_PUT_CREATED_OBJECT', 'integrity', 'probe-object-absent', 'probe-object-present');
  }
  const explicitExpiry = expiryRejected(reply);
  if (!explicitExpiry && !expiryNeedsControl(reply)) {
    throw httpFailure('SMOKE_INVALID_EXPIRED_ACCEPTANCE', 'expired-signature', reply);
  }
  emit?.('r2', 'expired-put-response', 'R2_EXPIRED_PUT_RESPONSE', explicitExpiry ? 'OK' : 'NOT_OBSERVED', {
    expected: 'expired-signature', actual: explicitExpiry ? 'explicit-expiry' : 'opaque-denial-awaiting-fresh-control',
  });
}

// Prove the same key, headers and credentials still work after the expiry test.
async function confirmFreshExpiryControl(env: SmokeBindings, key: string, emit?: Trace): Promise<void> {
  await putBackup(env, key, emit);
  if (!matchesBackup(await head(env, key, emit))) {
    throw new SmokeFailure('SMOKE_EXPIRY_FRESH_CONTROL_FAILED', 'integrity', 'exact-size-type-etag', 'metadata-mismatch');
  }
  emit?.('r2', 'expired-put-proof', 'R2_EXPIRED_PUT_PROVEN', 'OK', {
    expected: 'same-url-denied-only-after-expiry', actual: 'fresh-url-still-authorized',
  });
}

function d1ReadFailure(code: string, error: unknown): SmokeFailure {
  const permanent = error instanceof Error && /no such (?:table|column)|not authorized|permission denied/i.test(error.message);
  return new SmokeFailure(code, 'storage', 'd1-read-response', permanent ? 'd1-schema-or-access-invalid' : 'd1-query-rejected', !permanent);
}

async function readJob(env: SmokeBindings, key: string, emit?: Trace): Promise<SmokeJob | null> {
  try {
    return await observed(emit, 'd1', 'job-read', 'D1_JOB_SELECT', { expected: 'job-row', details: { table: 'migration_jobs', sql: 'SELECT' } },
      () => env.JOBS.prepare(
      'SELECT id, state, object_etag, object_size, content_type, event_at, event_action, error_code, created_at, updated_at'
      + ' FROM migration_jobs WHERE object_key = ?',
    ).bind(key).first<SmokeJob>(), row => ({ actual: row ? 'row-found' : 'row-missing',
        details: { table: 'migration_jobs', sql: 'SELECT', exists: !!row, state: row?.state ?? 'missing' } }));
  } catch (error) {
    throw d1ReadFailure('SMOKE_D1_JOB_READ_FAILED', error);
  }
}

async function deleteSmokeObjects(env: SmokeBindings, keys: string[], emit?: Trace): Promise<void> {
  if (!keys.length) {
    emit?.('cleanup', 'object-delete', 'R2_DELETE', 'SKIPPED', { actual: 'no-objects' });
    return;
  }
  if (!keys.every(key => SMOKE_OBJECT_PATTERN.test(key))) {
    throw new SmokeFailure('SMOKE_CLEANUP_SCOPE_INVALID', 'configuration', 'synthetic-smoke-keys', 'unexpected-key');
  }
  try {
    await observed(emit, 'cleanup', 'object-delete', 'R2_DELETE', { expected: 'deleted', details: { count: keys.length } },
      () => env.UPLOADS.delete(keys));
  } catch {
    throw new SmokeFailure('SMOKE_R2_CLEANUP_FAILED', 'storage', 'synthetic-objects-removed', 'r2-delete-rejected', true);
  }
}

async function sweepOldSmokeObjects(env: SmokeBindings, emit?: Trace): Promise<void> {
  try {
    // A bounded sweep also covers manually terminated runs that cannot enter finally.
    const objects: string[] = [];
    const cutoff = Date.now() - PREVIOUS_RUN_AGE_MS;
    let cursor: string | undefined;
    for (let page = 0; page < 4; page++) {
      const listing = await observed(emit, 'cleanup', 'object-list', 'R2_SMOKE_LIST', { attempt: page + 1, expected: 'list-page' },
        () => env.UPLOADS.list({ prefix: 'smoke/', limit: 100, cursor }),
        value => ({ actual: 'list-page', details: { count: value.objects.length, truncated: value.truncated } }));
      objects.push(...listing.objects.filter(object => SMOKE_OBJECT_PATTERN.test(object.key)
        && object.uploaded.getTime() < cutoff).map(object => object.key));
      if (!listing.truncated) break;
      cursor = listing.cursor;
    }
    await deleteSmokeObjects(env, objects, emit);
    if (emit) {
      const listing = await observed(emit, 'cleanup', 'trace-list', 'R2_TRACE_LIST', { expected: 'list-page' },
        () => env.UPLOADS.list({ prefix: TRACE_PREFIX, limit: 100 }));
      const old = listing.objects.filter(object => isTraceObject(object.key) && object.uploaded.getTime() < cutoff).map(object => object.key);
      if (old.length) await observed(emit, 'cleanup', 'trace-delete', 'R2_TRACE_DELETE', { expected: 'expired-traces-deleted', details: { count: old.length } },
        () => env.UPLOADS.delete(old));
    }
  } catch (error) {
    if (error instanceof SmokeFailure) throw error;
    throw new SmokeFailure('SMOKE_R2_SWEEP_FAILED', 'storage', 'synthetic-prefix-list', 'r2-list-rejected', true);
  }
}

export async function runMigrationSmoke(env: SmokeBindings, id: string, step: WorkflowStep,
  permanent: (message: string) => Error, context?: TraceContext): Promise<string> {
  const bindingProblem = typeof env.UPLOADS?.head !== 'function' || typeof env.UPLOADS?.list !== 'function'
    || typeof env.UPLOADS?.delete !== 'function' ? 'missing-uploads-binding'
    : typeof env.JOBS?.prepare !== 'function' ? 'missing-jobs-binding'
      : typeof env.EVENTS?.send !== 'function' ? 'missing-events-binding' : null;
  if (bindingProblem) {
    throw permanent(new SmokeFailure('SMOKE_BINDINGS_INVALID', 'configuration', 'configured-worker-bindings', bindingProblem).message);
  }
  const execute = async <T>(name: string, options: typeof READ | typeof WRITE | typeof WAIT, attempt: number | undefined,
    action: (emit?: Trace) => Promise<T>): Promise<T> => {
    const trace = context ? workerTrace(env.UPLOADS, { ...context, attempt }) : undefined;
    const emit = trace?.emit;
    const stage = traceStepName(name);
    const start = Date.now();
    const retry = { retry_limit: options.retries.limit, backoff: options.retries.backoff,
      timeout_ms: Number.parseInt(options.timeout) * 1000, delay_ms: Number.parseInt(options.retries.delay) * 1000 };
    emit?.('workflow', stage, 'WORKFLOW_STEP', 'STARTED', { expected: 'step-completed', details: retry });
    try {
      const result = await action(emit);
      emit?.('workflow', stage, 'WORKFLOW_STEP', 'OK', { actual: 'step-completed', duration_ms: Date.now() - start });
      return result;
    } catch (error) {
      const failure = error instanceof SmokeFailure ? error : new SmokeFailure('SMOKE_UNEXPECTED_RUNTIME',
        'runtime', 'operation-completed', 'runtime-error');
      const [code, , expected, actual] = failure.message.split('|');
      emit?.('workflow', stage, 'WORKFLOW_STEP', 'FAILED', { error_code: code, expected, actual, duration_ms: Date.now() - start,
        details: { classification: classifyTraceError(error) } });
      const canRetry = failure.retryable && (attempt == null || attempt <= retry.retry_limit);
      emit?.('workflow', stage, 'WORKFLOW_STEP_RETRY', canRetry ? 'RETRY' : 'SKIPPED', { error_code: code,
        actual: canRetry ? 'retry-eligible' : 'not-retryable-or-exhausted', details: { can_retry: canRetry, ...retry } });
      if (failure.retryable) throw failure;
      throw permanent(failure.message);
    } finally {
      await trace?.flush();
    }
  };
  const run = (name: string, options: typeof READ | typeof WRITE, action: (emit?: Trace) => Promise<void>) =>
    step.do(name, options, stepContext => execute(name, options, stepContext?.attempt, action));
  if (!SMOKE_OBJECT_PATTERN.test('smoke/' + id)) {
    throw permanent(new SmokeFailure('SMOKE_WORKFLOW_INPUT_INVALID', 'configuration', 'smoke-payload-and-uuid', 'invalid-input').message);
  }
  const key = 'smoke/' + id;
  if (context) {
    const trace = workerTrace(env.UPLOADS, context);
    trace.emit('r2', 'smoke-key', 'R2_SMOKE_KEY_GENERATED', 'OK', { expected: 'synthetic-object-key', actual: 'smoke-key-validated' });
    await trace.flush();
  }
  const probeKeys = smokeProbeKeys(key);
  let failure: unknown;
  try {
    await run('Sweep expired smoke objects', READ, emit => sweepOldSmokeObjects(env, emit));
    await run('Upload signed R2 backup', WRITE, emit => putBackup(env, key, emit));
    await run('Verify R2 HEAD', READ, async emit => {
      const object = await head(env, key, emit);
      if (!matchesBackup(object)) {
        throw new SmokeFailure('SMOKE_HEAD_MISMATCH', 'integrity', 'exact-size-type-etag',
          object ? 'metadata-mismatch' : 'object-missing');
      }
    });
    const job = await step.do('Observe R2 notification in D1', WAIT, stepContext => execute('Observe R2 notification in D1', WAIT, stepContext?.attempt, async emit => {
      emit?.('workflow', 'event-wait', 'R2_EVENT_WAIT_POLL', 'STARTED', { expected: 'registered-put-event',
        details: { poll: stepContext?.attempt, remaining_ms: Math.max(0, 60000 - Math.max(0, (stepContext?.attempt ?? 1) - 1) * 5000) } });
      const row = await readJob(env, key, emit);
      if (!row) {
        emit?.('workflow', 'event-wait', 'R2_EVENT_WAIT_POLL', 'NOT_OBSERVED', {
          error_code: 'SMOKE_D1_EVENT_PENDING', expected: 'registered-put-event', actual: 'job-missing',
          details: { poll: stepContext?.attempt, remaining_ms: Math.max(0, 60000 - Math.max(0, (stepContext?.attempt ?? 1) - 1) * 5000) },
        });
        throw new SmokeFailure('SMOKE_D1_EVENT_PENDING', 'delivery', 'registered-put-event', 'job-missing', true);
      }
      if (row.state !== 'uploaded' || row.id !== key || row.object_etag !== ETAG
        || row.object_size !== BACKUP.sizeBytes || row.content_type !== CONTENT_TYPE || row.event_action !== 'PutObject') {
        const actual = ['OBJECT_MISSING', 'OBJECT_MISMATCH', 'INVALID_BACKUP_METADATA'].includes(row.error_code ?? '')
          ? row.error_code ?? 'metadata-mismatch' : 'metadata-mismatch';
        throw new SmokeFailure('SMOKE_D1_EVENT_MISMATCH', 'integrity', 'registered-put-event', actual);
      }
      emit?.('workflow', 'event-wait', 'R2_EVENT_WAIT_POLL', 'OK', { actual: 'registered-put-event' });
      return row;
    }));
    await run('Replay R2 event via Queue', WRITE, async emit => {
      try {
        await observed(emit, 'queue', 'replay-send', 'QUEUE_REPLAY_SEND', { expected: 'replay-accepted', details: { replay: true } },
          () => env.EVENTS.send({
          account: env.CLOUDFLARE_ACCOUNT_ID, bucket: UPLOAD_BUCKET, action: job.event_action,
          object: { key, size: job.object_size, eTag: job.object_etag }, eventTime: job.event_at, smokeReplay: id,
        }, { contentType: 'json' }));
      } catch {
        // Retried sends use the same marker. D1 records it once, even if Queue accepted an earlier attempt.
        throw new SmokeFailure('SMOKE_QUEUE_SEND_FAILED', 'delivery', 'replay-accepted', 'queue-send-rejected', true);
      }
    });
    await step.do('Verify exact Queue replay receipt', WAIT, stepContext =>
      execute('Verify exact Queue replay receipt', WAIT, stepContext?.attempt, async emit => {
      let receipt: { object_key: string } | null;
      try {
        receipt = await observed(emit, 'd1', 'replay-select', 'D1_REPLAY_SELECT',
          { expected: 'replay-receipt', details: { table: 'migration_smoke_replays', sql: 'SELECT' } },
          () => env.JOBS.prepare('SELECT object_key FROM migration_smoke_replays WHERE replay_id = ?')
            .bind(id).first<{ object_key: string }>(),
          row => ({ actual: row ? 'row-found' : 'row-missing', details: { exists: !!row } }));
      } catch (error) {
        throw d1ReadFailure('SMOKE_D1_RECEIPT_READ_FAILED', error);
      }
      if (!receipt) throw new SmokeFailure('SMOKE_QUEUE_REPLAY_PENDING', 'delivery', 'exact-replay-receipt', 'receipt-missing', true);
      const row = await readJob(env, key, emit);
      if (receipt.object_key !== key || !row || Object.keys(job).some(field => row[field as keyof SmokeJob] !== job[field as keyof SmokeJob])) {
        throw new SmokeFailure('SMOKE_QUEUE_REPLAY_MISMATCH', 'integrity', 'unchanged-job-and-valid-receipt', 'job-or-receipt-mismatch');
      }
    }));
    for (const [index, kind] of PROBES.entries()) {
      await run('Reject signed PUT ' + kind, READ, emit => negativePut(env, probeKeys[index], kind, emit));
    }
    const expiryKey = key + '/expired';
    const expiry = await step.do('Prime signed PUT expiry control', WRITE, stepContext =>
      execute('Prime signed PUT expiry control', WRITE, stepContext?.attempt, emit => primeExpiry(env, expiryKey, emit)));
    await step.sleepUntil('Wait for signed PUT expiration', new Date(expiry.expiresAt + EXPIRY_CLOCK_MARGIN_MS));
    await run('Reject signed PUT expired', WRITE, emit => rejectExpired(env, expiryKey, expiry, emit));
    await run('Verify fresh PUT after expiry', WRITE, emit => confirmFreshExpiryControl(env, expiryKey, emit));
    await run('Reject conditional overwrite', READ, async emit => {
      const before = await head(env, key, emit);
      if (!before || !matchesBackup(before)) {
        throw new SmokeFailure('SMOKE_OVERWRITE_CONTROL_MISSING', 'integrity', 'existing-backup', 'backup-unverified');
      }
      const reply = await request(await sign(key, env, undefined, emit), BODY, CONTENT_TYPE, true, emit);
      if (!writeOnceRejected(reply)) throw httpFailure('SMOKE_OVERWRITE_NOT_REJECTED', 'http-412-PreconditionFailed', reply);
      const after = await head(env, key, emit);
      if (!after || !matchesBackup(after) || before.version !== after.version) {
        throw new SmokeFailure('SMOKE_OVERWRITE_CHANGED_OBJECT', 'integrity', 'unchanged-object-version', 'object-changed');
      }
    });
    await run('Reject anonymous R2 GET', READ, async emit => {
      const url = new URL(await sign(key, env, undefined, emit));
      url.search = '';
      const reply = await request(url.href, undefined, CONTENT_TYPE, false, emit);
      if (!anonymousRejected(reply)) throw httpFailure('SMOKE_PUBLIC_READ_NOT_REJECTED', 'anonymous-access-denied', reply);
    });
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      await run('Delete current smoke objects', WRITE, emit => deleteSmokeObjects(env, [key, ...probeKeys], emit));
    } catch (error) {
      if (!failure) throw error;
      // Preserve the primary fault. The cleanup step's attempts are visible in instance history.
    }
  }
  return 'MIGRATION_SMOKE_OK';
}

export async function cleanupMigrationSmoke(env: SmokeBindings, id: string, step: WorkflowStep, context?: TraceContext): Promise<string> {
  const key = 'smoke/' + id;
  await step.do('Delete failed smoke objects', WRITE, async stepContext => {
    const trace = context ? workerTrace(env.UPLOADS, { ...context, attempt: stepContext?.attempt }) : undefined;
    try {
      await observed(trace?.emit, 'workflow', 'delete-failed-smoke-objects', 'WORKFLOW_STEP', { expected: 'step-completed',
        details: { retry_limit: WRITE.retries.limit, timeout_ms: 20000, backoff: WRITE.retries.backoff } },
      () => deleteSmokeObjects(env, [key, ...smokeProbeKeys(key)], trace?.emit));
    } finally {
      await trace?.flush();
    }
  });
  return 'MIGRATION_SMOKE_CLEANUP_OK';
}
