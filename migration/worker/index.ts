import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { consumeUploads, type UploadEvent } from './events';
import { SMOKE_ID_PATTERN, UPLOAD_BUCKET, UPLOAD_TTL_SECONDS, signBackupPut, verifyBackupUpload,
  type UploadCredentials } from './r2-upload';

interface Env extends UploadCredentials {
  UPLOADS: R2Bucket;
  JOBS: D1Database;
  EVENTS: Queue<UploadEvent>;
}

export default { queue: consumeUploads } satisfies ExportedHandler<Env, unknown>;

interface SmokeJob {
  state: string;
  object_etag: string;
  object_size: number;
  content_type: string;
  event_at: string;
  event_action: string;
  deliveries: number;
}

const CONTENT_TYPE = 'application/octet-stream';
const BODY = 'mezfit-migration-smoke\n';
const BACKUP = { sizeBytes: BODY.length, contentType: CONTENT_TYPE };

async function put(url: string, body: string, type: string, writeOnce = true): Promise<number> {
  // Workers sets Content-Length automatically for a fixed-length body.
  try {
    const response = await fetch(url, {
      method: 'PUT', body, redirect: 'error',
      headers: { 'Content-Type': type, ...(writeOnce ? { 'If-None-Match': '*' } : {}) },
    });
    await response.body?.cancel();
    return response.status;
  } catch {
    throw new Error('SMOKE_SIGNED_PUT_REQUEST_FAILED');
  }
}

function signatureDenied(status: number): boolean {
  return status === 400 || status === 403;
}

async function checkSignedUpload(env: Env, key: string): Promise<void> {
  const { putUrl } = await signBackupPut(key, BACKUP, env);
  const parsed = new URL(putUrl);
  if (parsed.searchParams.get('X-Amz-Expires') !== String(UPLOAD_TTL_SECONDS)) {
    throw new Error('SMOKE_SIGNED_PUT_TTL_MISMATCH');
  }
  if (!signatureDenied(await put(putUrl, BODY, 'application/zip'))
    || !signatureDenied(await put(putUrl, BODY + 'x', CONTENT_TYPE))
    || !signatureDenied(await put(putUrl, BODY, CONTENT_TYPE, false))) {
    throw new Error('SMOKE_SIGNED_PUT_HEADER_CHECK_FAILED');
  }
  const expired = await signBackupPut(key, BACKUP, env, new Date(Date.now() - 2 * UPLOAD_TTL_SECONDS * 1000));
  if (await put(expired.putUrl, BODY, CONTENT_TYPE) !== 403) throw new Error('SMOKE_EXPIRED_PUT_CHECK_FAILED');
  const upload = await put(putUrl, BODY, CONTENT_TYPE);
  if (upload !== 200 && upload !== 412) throw new Error('SMOKE_SIGNED_PUT_FAILED');
  if (await put(putUrl, BODY, CONTENT_TYPE) !== 412
    || !await verifyBackupUpload(env.UPLOADS, key, BACKUP)) {
    throw new Error('SMOKE_WRITE_ONCE_OR_HEAD_FAILED');
  }
  parsed.search = '';
  let response: Response;
  try {
    response = await fetch(parsed, { redirect: 'error' });
  } catch {
    throw new Error('SMOKE_ANONYMOUS_READ_REQUEST_FAILED');
  }
  await response.body?.cancel();
  if (response.status !== 401 && response.status !== 403) throw new Error('SMOKE_ANONYMOUS_READ_ALLOWED');
}

const WAIT_FOR_EVENT = { retries: { limit: 20, delay: '5 seconds', backoff: 'constant' }, timeout: '10 seconds' } as const;

export class MigrationWorkflow extends WorkflowEntrypoint<Env, { operation: 'smoke' }> {
  async run(event: WorkflowEvent<{ operation: 'smoke' }>, step: WorkflowStep): Promise<string> {
    if (event.payload?.operation !== 'smoke' || !SMOKE_ID_PATTERN.test(event.instanceId)) {
      throw new Error('MIGRATION_WORKFLOW_UNSUPPORTED_OPERATION');
    }
    const key = 'smoke/' + event.instanceId;
    await step.do('check signed upload and bucket privacy',
      { retries: { limit: 1, delay: '5 seconds' }, timeout: '30 seconds' },
      () => checkSignedUpload(this.env, key));

    const readJob = () => this.env.JOBS.prepare(
      'SELECT state, object_etag, object_size, content_type, event_at, event_action, deliveries'
      + ' FROM migration_jobs WHERE object_key = ?',
    ).bind(key).first<SmokeJob>();

    const original = await step.do('observe R2 event in D1', WAIT_FOR_EVENT, async () => {
      const job = await readJob();
      if (job?.state !== 'uploaded' || job.object_size !== BACKUP.sizeBytes
        || job.content_type !== CONTENT_TYPE || job.event_action !== 'PutObject') {
        throw new Error('SMOKE_R2_EVENT_NOT_REGISTERED');
      }
      return job;
    });
    await step.do('replay original R2 event', async () => {
      await this.env.EVENTS.send({
        account: this.env.CLOUDFLARE_ACCOUNT_ID, bucket: UPLOAD_BUCKET, action: original.event_action,
        object: { key, size: original.object_size, eTag: original.object_etag }, eventTime: original.event_at,
      });
    });
    await step.do('verify idempotent replay in D1', WAIT_FOR_EVENT, async () => {
      const job = await readJob();
      if (!job || job.deliveries <= original.deliveries || job.state !== 'uploaded'
        || job.object_etag !== original.object_etag || job.event_at !== original.event_at) {
        throw new Error('SMOKE_EVENT_REPLAY_NOT_OBSERVED');
      }
    });
    await step.do('delete synthetic backup', async () => {
      await this.env.UPLOADS.delete(key);
    });
    return 'MIGRATION_SMOKE_OK';
  }
}
