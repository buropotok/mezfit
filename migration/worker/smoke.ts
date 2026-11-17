import type { WorkflowStep } from 'cloudflare:workers';
import type { UploadEvent } from './events';
import { SMOKE_OBJECT_PATTERN, UPLOAD_BUCKET, UPLOAD_TTL_SECONDS, signBackupPut,
  backupObjectMatches, type UploadCredentials } from './r2-upload';
import { anonymousRejected, expiryRejected, readS3Reply, signatureRejected, writeOnceRejected,
  type S3Reply } from './smoke-http';

export interface SmokeBindings extends UploadCredentials {
  UPLOADS: R2Bucket;
  JOBS: D1Database;
  EVENTS: Queue<UploadEvent>;
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
const PROBES = ['mime', 'length', 'conditional', 'expired'] as const;
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

async function request(url: string, body?: Uint8Array<ArrayBuffer>, type = CONTENT_TYPE, conditional = true): Promise<S3Reply> {
  try {
    // Workers sets Content-Length from the fixed-size TypedArray. The signed value is never set manually.
    const response = await fetch(url, {
      method: body ? 'PUT' : 'GET', redirect: 'manual', signal: AbortSignal.timeout(8000),
      ...(body ? { body, headers: { 'Content-Type': type, ...(conditional ? { 'If-None-Match': '*' } : {}) } } : {}),
    });
    return await readS3Reply(response);
  } catch {
    throw new SmokeFailure('SMOKE_R2_TRANSPORT', 'transient', 's3-response', 'network-or-timeout', true);
  }
}

async function sign(key: string, env: SmokeBindings, now?: Date): Promise<string> {
  try {
    const signed = await signBackupPut(key, BACKUP, env, now);
    if (new URL(signed.putUrl).searchParams.get('X-Amz-Expires') !== String(UPLOAD_TTL_SECONDS)) {
      throw new Error('wrong-ttl');
    }
    return signed.putUrl;
  } catch {
    throw new SmokeFailure('SMOKE_SIGNER_FAILED', 'configuration', 'configured-signer-and-valid-ttl', 'signer-unavailable');
  }
}

async function head(env: SmokeBindings, key: string): Promise<R2Object | null> {
  try {
    return await env.UPLOADS.head(key);
  } catch {
    throw new SmokeFailure('SMOKE_R2_HEAD_FAILED', 'storage', 'r2-head-response', 'r2-head-rejected', true);
  }
}

function matchesBackup(object: R2Object | null): boolean {
  return backupObjectMatches(object, BACKUP) && object?.etag.toLowerCase() === ETAG;
}

async function putBackup(env: SmokeBindings, key: string): Promise<void> {
  const existing = await head(env, key);
  if (existing) {
    if (matchesBackup(existing)) return; // Reconcile a previous attempt that committed before losing its reply.
    throw new SmokeFailure('SMOKE_UPLOAD_KEY_OCCUPIED', 'integrity', 'empty-or-own-backup', 'unexpected-object');
  }
  const reply = await request(await sign(key, env), BODY);
  if (reply.status === 200) return;
  if (writeOnceRejected(reply) && matchesBackup(await head(env, key))) return;
  throw httpFailure('SMOKE_SIGNED_PUT_FAILED', 'http-200', reply);
}

async function negativePut(env: SmokeBindings, key: string, kind: typeof PROBES[number]): Promise<void> {
  const expired = kind === 'expired';
  const now = expired ? new Date(Date.now() - (UPLOAD_TTL_SECONDS + 60) * 1000) : undefined;
  const url = await sign(key, env, now);
  const bytes = kind === 'length' ? new Uint8Array(BODY.byteLength + 1) : BODY;
  const reply = await request(url, bytes, kind === 'mime' ? 'application/zip' : CONTENT_TYPE, kind !== 'conditional');
  if (await head(env, key)) {
    throw new SmokeFailure('SMOKE_BAD_PUT_CREATED_OBJECT', 'integrity', 'probe-object-absent', 'probe-object-present');
  }
  if (!(expired ? expiryRejected(reply) : signatureRejected(reply, kind === 'conditional'))) {
    throw httpFailure('SMOKE_INVALID_' + kind.toUpperCase() + '_ACCEPTANCE', expired ? 'expired-signature' : 'signature-rejection', reply);
  }
}

function d1ReadFailure(code: string, error: unknown): SmokeFailure {
  const permanent = error instanceof Error && /no such (?:table|column)|not authorized|permission denied/i.test(error.message);
  return new SmokeFailure(code, 'storage', 'd1-read-response', permanent ? 'd1-schema-or-access-invalid' : 'd1-query-rejected', !permanent);
}

async function readJob(env: SmokeBindings, key: string): Promise<SmokeJob | null> {
  try {
    return await env.JOBS.prepare(
      'SELECT id, state, object_etag, object_size, content_type, event_at, event_action, error_code, created_at, updated_at'
      + ' FROM migration_jobs WHERE object_key = ?',
    ).bind(key).first<SmokeJob>();
  } catch (error) {
    throw d1ReadFailure('SMOKE_D1_JOB_READ_FAILED', error);
  }
}

async function deleteSmokeObjects(env: SmokeBindings, keys: string[]): Promise<void> {
  if (!keys.length) return;
  if (!keys.every(key => SMOKE_OBJECT_PATTERN.test(key))) {
    throw new SmokeFailure('SMOKE_CLEANUP_SCOPE_INVALID', 'configuration', 'synthetic-smoke-keys', 'unexpected-key');
  }
  try {
    await env.UPLOADS.delete(keys);
  } catch {
    throw new SmokeFailure('SMOKE_R2_CLEANUP_FAILED', 'storage', 'synthetic-objects-removed', 'r2-delete-rejected', true);
  }
}

async function sweepOldSmokeObjects(env: SmokeBindings): Promise<void> {
  try {
    // A bounded sweep also covers manually terminated runs that cannot enter finally.
    const objects: string[] = [];
    const cutoff = Date.now() - PREVIOUS_RUN_AGE_MS;
    let cursor: string | undefined;
    for (let page = 0; page < 4; page++) {
      const listing = await env.UPLOADS.list({ prefix: 'smoke/', limit: 100, cursor });
      objects.push(...listing.objects.filter(object => SMOKE_OBJECT_PATTERN.test(object.key)
        && object.uploaded.getTime() < cutoff).map(object => object.key));
      if (!listing.truncated) break;
      cursor = listing.cursor;
    }
    await deleteSmokeObjects(env, objects);
  } catch (error) {
    if (error instanceof SmokeFailure) throw error;
    throw new SmokeFailure('SMOKE_R2_SWEEP_FAILED', 'storage', 'synthetic-prefix-list', 'r2-list-rejected', true);
  }
}

export async function runMigrationSmoke(env: SmokeBindings, id: string, step: WorkflowStep,
  permanent: (message: string) => Error): Promise<string> {
  const bindingProblem = typeof env.UPLOADS?.head !== 'function' || typeof env.UPLOADS?.list !== 'function'
    || typeof env.UPLOADS?.delete !== 'function' ? 'missing-uploads-binding'
    : typeof env.JOBS?.prepare !== 'function' ? 'missing-jobs-binding'
      : typeof env.EVENTS?.send !== 'function' ? 'missing-events-binding' : null;
  if (bindingProblem) {
    throw permanent(new SmokeFailure('SMOKE_BINDINGS_INVALID', 'configuration', 'configured-worker-bindings', bindingProblem).message);
  }
  const execute = async <T>(action: () => Promise<T>): Promise<T> => {
    try {
      return await action();
    } catch (error) {
      if (error instanceof SmokeFailure && error.retryable) throw error;
      if (error instanceof SmokeFailure) throw permanent(error.message);
      const kind = error instanceof TypeError ? 'type-error' : error instanceof RangeError ? 'range-error' : 'runtime-error';
      throw permanent(new SmokeFailure('SMOKE_UNEXPECTED_RUNTIME', 'runtime', 'operation-completed', kind).message);
    }
  };
  const run = (name: string, options: typeof READ | typeof WRITE, action: () => Promise<void>) =>
    step.do(name, options, () => execute(action));
  if (!SMOKE_OBJECT_PATTERN.test('smoke/' + id)) {
    throw permanent(new SmokeFailure('SMOKE_WORKFLOW_INPUT_INVALID', 'configuration', 'smoke-payload-and-uuid', 'invalid-input').message);
  }
  const key = 'smoke/' + id;
  const probeKeys = PROBES.map(kind => key + '/' + kind);
  let failure: unknown;
  try {
    await run('Sweep expired smoke objects', READ, () => sweepOldSmokeObjects(env));
    await run('Upload signed R2 backup', WRITE, () => putBackup(env, key));
    await run('Verify R2 HEAD', READ, async () => {
      const object = await head(env, key);
      if (!matchesBackup(object)) {
        throw new SmokeFailure('SMOKE_HEAD_MISMATCH', 'integrity', 'exact-size-type-etag',
          object ? 'metadata-mismatch' : 'object-missing');
      }
    });
    const job = await step.do('Observe R2 notification in D1', WAIT, () => execute(async () => {
      const row = await readJob(env, key);
      if (!row) throw new SmokeFailure('SMOKE_D1_EVENT_PENDING', 'delivery', 'registered-put-event', 'job-missing', true);
      if (row.state !== 'uploaded' || row.id !== key || row.object_etag !== ETAG
        || row.object_size !== BACKUP.sizeBytes || row.content_type !== CONTENT_TYPE || row.event_action !== 'PutObject') {
        const actual = ['OBJECT_MISSING', 'OBJECT_MISMATCH', 'INVALID_BACKUP_METADATA'].includes(row.error_code ?? '')
          ? row.error_code ?? 'metadata-mismatch' : 'metadata-mismatch';
        throw new SmokeFailure('SMOKE_D1_EVENT_MISMATCH', 'integrity', 'registered-put-event', actual);
      }
      return row;
    }));
    await run('Replay R2 event via Queue', WRITE, async () => {
      try {
        await env.EVENTS.send({
          account: env.CLOUDFLARE_ACCOUNT_ID, bucket: UPLOAD_BUCKET, action: job.event_action,
          object: { key, size: job.object_size, eTag: job.object_etag }, eventTime: job.event_at, smokeReplay: id,
        }, { contentType: 'json' });
      } catch {
        // Retried sends use the same marker. D1 records it once, even if Queue accepted an earlier attempt.
        throw new SmokeFailure('SMOKE_QUEUE_SEND_FAILED', 'delivery', 'replay-accepted', 'queue-send-rejected', true);
      }
    });
    await step.do('Verify exact Queue replay receipt', WAIT, () => execute(async () => {
      let receipt: { object_key: string } | null;
      try {
        receipt = await env.JOBS.prepare('SELECT object_key FROM migration_smoke_replays WHERE replay_id = ?')
          .bind(id).first<{ object_key: string }>();
      } catch (error) {
        throw d1ReadFailure('SMOKE_D1_RECEIPT_READ_FAILED', error);
      }
      if (!receipt) throw new SmokeFailure('SMOKE_QUEUE_REPLAY_PENDING', 'delivery', 'exact-replay-receipt', 'receipt-missing', true);
      const row = await readJob(env, key);
      if (receipt.object_key !== key || !row || Object.keys(job).some(field => row[field as keyof SmokeJob] !== job[field as keyof SmokeJob])) {
        throw new SmokeFailure('SMOKE_QUEUE_REPLAY_MISMATCH', 'integrity', 'unchanged-job-and-valid-receipt', 'job-or-receipt-mismatch');
      }
    }));
    for (const [index, kind] of PROBES.entries()) {
      await run('Reject signed PUT ' + kind, READ, () => negativePut(env, probeKeys[index], kind));
    }
    await run('Reject conditional overwrite', READ, async () => {
      const reply = await request(await sign(key, env), BODY);
      if (!writeOnceRejected(reply)) throw httpFailure('SMOKE_OVERWRITE_NOT_REJECTED', 'http-412-PreconditionFailed', reply);
    });
    await run('Reject anonymous R2 GET', READ, async () => {
      const url = new URL(await sign(key, env));
      url.search = '';
      const reply = await request(url.href);
      if (!anonymousRejected(reply)) throw httpFailure('SMOKE_PUBLIC_READ_NOT_REJECTED', 'anonymous-access-denied', reply);
    });
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      await run('Delete current smoke objects', WRITE, () => deleteSmokeObjects(env, [key, ...probeKeys]));
    } catch (error) {
      if (!failure) throw error;
      // Preserve the primary fault. The cleanup step's attempts are visible in instance history.
    }
  }
  return 'MIGRATION_SMOKE_OK';
}

export async function cleanupMigrationSmoke(env: SmokeBindings, id: string, step: WorkflowStep): Promise<string> {
  const key = 'smoke/' + id;
  await step.do('Delete failed smoke objects', WRITE,
    () => deleteSmokeObjects(env, [key, ...PROBES.map(kind => key + '/' + kind)]));
  return 'MIGRATION_SMOKE_CLEANUP_OK';
}
