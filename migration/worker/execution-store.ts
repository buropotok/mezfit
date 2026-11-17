import { PROCESSOR_VERSION, processorInstanceId, processorResultKey } from '../processor-protocol.mjs';
import { type Trace } from '../trace.mjs';
import { validBackupMetadata } from './r2-upload';
import { observed } from './trace';
import { ProcessingFailure } from './processor';

export type ProcessOperation = {
  operation: 'process';
  jobId: string;
  expectedVersion?: string;
  runId?: string;
};

export interface ExecutionBindings {
  UPLOADS: R2Bucket;
  JOBS: D1Database;
}

export type QueueExecutionBindings = ExecutionBindings & { MIGRATION_WORKFLOW: Workflow<ProcessOperation> };

const EXISTING_WORKFLOW_STATES = ['queued', 'running', 'paused', 'errored', 'terminated', 'complete', 'waiting', 'waitingForPause'];
const STATES = ['queued', 'running', 'succeeded', 'failed', 'unsupported'] as const;
type State = typeof STATES[number];

export interface Execution {
  state: State;
  attempts: number;
  etag: string;
  size: number;
  mime: string;
  resultKey: string | null;
  checksum: string | null;
  errorCode: string | null;
}

const ETAG = /^[a-f0-9]{32}(?:-[1-9][0-9]*)?$/;
const SHA256 = /^[a-f0-9]{64}$/;
const DETAILS = { table: 'migration_executions' };
const sourceKey = (id: string) => 'uploads/' + id;

function executionQuery(db: D1Database, id: string) {
  return db.prepare(`SELECT e.*, j.object_etag AS registered_etag, j.object_size, j.content_type, j.state AS job_state
    FROM migration_executions e JOIN migration_jobs j ON j.id = e.job_id
    WHERE e.job_id = ? AND e.processor_version = ?`).bind(sourceKey(id), PROCESSOR_VERSION);
}

function decodeExecution(row: Record<string, unknown> | null, id: string): Execution | null {
  if (!row) return null;
  const state = STATES.find(value => value === row.state);
  if (!state || row.job_state !== 'uploaded' || row.workflow_id !== processorInstanceId(id)
    || row.object_key !== sourceKey(id) || typeof row.object_etag !== 'string' || !ETAG.test(row.object_etag)
    || row.registered_etag !== row.object_etag || typeof row.object_size !== 'number'
    || typeof row.content_type !== 'string' || !validBackupMetadata(row.object_size, row.content_type)
    || typeof row.attempts !== 'number' || !Number.isSafeInteger(row.attempts) || row.attempts < 0
    || (state === 'succeeded' ? row.result_key !== processorResultKey(id) || typeof row.result_sha256 !== 'string'
      || !SHA256.test(row.result_sha256) : row.result_key !== null || row.result_sha256 !== null)
    || (state === 'failed' || state === 'unsupported'
      ? typeof row.error_code !== 'string' || !/^[A-Z][A-Z0-9_]{0,80}$/.test(row.error_code)
      : row.error_code !== null)) {
    throw new ProcessingFailure('INVALID_EXECUTION_STATE');
  }
  return { state, attempts: row.attempts, etag: row.object_etag, size: row.object_size, mime: row.content_type,
    resultKey: typeof row.result_key === 'string' ? row.result_key : null,
    checksum: typeof row.result_sha256 === 'string' ? row.result_sha256 : null,
    errorCode: typeof row.error_code === 'string' ? row.error_code : null };
}

export async function readExecution(db: D1Database, id: string, emit: Trace): Promise<Execution | null> {
  const row = await observed(emit, 'd1', 'execution-read', 'D1_EXECUTION_READ', { details: { ...DETAILS, sql: 'SELECT' } },
    () => executionQuery(db, id).first(), value => ({ actual: value ? 'row-found' : 'row-missing' }));
  return decodeExecution(row, id);
}

export function executionStatements(db: D1Database, id: string, etag: string, size: number, eventAt: string, emit: Trace) {
  const now = new Date().toISOString();
  emit('d1', 'execution-create', 'D1_EXECUTION_CREATE', 'STARTED', { details: { ...DETAILS, sql: 'INSERT' } });
  emit('d1', 'execution-read', 'D1_EXECUTION_READ', 'STARTED', { details: { ...DETAILS, sql: 'SELECT' } });
  return [db.prepare(`INSERT INTO migration_executions
    (job_id, processor_version, workflow_id, object_key, object_etag, state, created_at, updated_at)
    SELECT id, ?, ?, object_key, object_etag, 'queued', ?, ? FROM migration_jobs
    WHERE id = ? AND state = 'uploaded' AND object_etag = ? AND object_size = ? AND event_at = ?
    ON CONFLICT(job_id, processor_version) DO NOTHING`)
    .bind(PROCESSOR_VERSION, processorInstanceId(id), now, now, sourceKey(id), etag, size, eventAt), executionQuery(db, id)];
}

export async function dispatchExecution(env: QueueExecutionBindings, id: string, etag: string, size: number,
  [written, selected]: D1Result<Record<string, unknown>>[], emit: Trace,
  context: Pick<ProcessOperation, 'expectedVersion' | 'runId'>) {
  if (!written?.success || !selected?.success) throw new Error('D1_EXECUTION_CREATE_FAILED');
  const current = decodeExecution(selected.results[0] ?? null, id);
  emit('d1', 'execution-create', 'D1_EXECUTION_CREATE', 'OK', { actual: 'committed',
    details: { ...DETAILS, sql: 'INSERT', affected_rows: written.meta.changes } });
  emit('d1', 'execution-read', 'D1_EXECUTION_READ', 'OK', { actual: current ? 'row-found' : 'row-missing' });
  if (!current || current.etag !== etag || current.size !== size) {
    emit('d1', 'execution-create', 'D1_EXECUTION_SKIPPED', 'SKIPPED', { actual: 'registered-object-mismatch' });
    return;
  }
  emit('d1', 'execution-create', written.meta.changes === 1 ? 'D1_EXECUTION_CREATED' : 'D1_EXECUTION_EXISTS', 'OK',
    { actual: current.state, details: { state: current.state, affected_rows: written.meta.changes } });
  if (current.state !== 'queued') return;

  const instance = processorInstanceId(id);
  try {
    await observed(emit, 'workflow', 'process-dispatch', 'PROCESS_WORKFLOW_CREATE', { expected: 'accepted' },
      () => env.MIGRATION_WORKFLOW.create({ id: instance, params: { operation: 'process', jobId: id, ...context } }));
  } catch (error) {
    // Duplicate creates and a lost response share the same recovery path. A handle
    // alone is insufficient. Cloudflare confirms the instance through status().
    await observed(emit, 'workflow', 'process-dispatch-readback', 'PROCESS_WORKFLOW_READBACK', { expected: 'existing-instance' },
      async () => {
        const handle = await env.MIGRATION_WORKFLOW.get(instance);
        const { status } = await handle.status();
        if (!EXISTING_WORKFLOW_STATES.includes(status)) throw error;
        return status;
      }, status => ({ actual: status }));
    emit('workflow', 'process-dispatch', 'PROCESS_WORKFLOW_CREATE', 'OK', { actual: 'reconciled' });
  }
}

export type Terminal = { state: 'succeeded'; key: string; checksum: string } |
  { state: 'failed' | 'unsupported'; code: string };

export async function transition(db: D1Database, id: string, next: 'running' | Terminal, emit: Trace) {
  const state = next === 'running' ? next : next.state;
  const key = next !== 'running' && next.state === 'succeeded' ? next.key : null;
  const checksum = next !== 'running' && next.state === 'succeeded' ? next.checksum : null;
  const code = next !== 'running' && next.state !== 'succeeded' ? next.code : null;
  const details = { ...DETAILS, sql: 'UPDATE', state };
  emit('d1', 'execution-transition', 'D1_STATE_TRANSITION_STARTED', 'STARTED', { expected: state, details });
  const result = await observed(emit, 'd1', 'execution-write', 'D1_EXECUTION_UPDATE', { details },
    () => db.prepare(`UPDATE migration_executions
      SET state = ?, result_key = ?, result_sha256 = ?, error_code = ?, updated_at = ?,
        attempts = attempts + CASE WHEN ? = 'running' THEN 1 ELSE 0 END
      WHERE job_id = ? AND processor_version = ? AND workflow_id = ? AND state = ?`)
      .bind(state, key, checksum, code, new Date().toISOString(), state, sourceKey(id), PROCESSOR_VERSION,
        processorInstanceId(id), state === 'running' ? 'queued' : 'running').run(),
    row => ({ error_code: row.success ? undefined : 'D1_EXECUTION_WRITE_FAILED' }));
  if (!result.success) throw new Error('D1_EXECUTION_WRITE_FAILED');
  if (next !== 'running') emit('d1', 'execution-final-read', 'D1_FINAL_READBACK_STARTED', 'STARTED');
  const row = await readExecution(db, id, emit);
  const matched = row?.state === state && row.resultKey === key && row.checksum === checksum && row.errorCode === code;
  if (!row || !matched && !(state === 'running' && row.state !== 'queued')) {
    emit('d1', 'execution-transition', 'D1_STATE_TRANSITION_REJECTED', 'FAILED',
      { expected: state, actual: row?.state ?? 'missing', error_code: 'D1_EXECUTION_TRANSITION_REJECTED' });
    throw new ProcessingFailure('D1_EXECUTION_TRANSITION_REJECTED');
  }
  emit('d1', 'execution-transition', 'D1_STATE_TRANSITION_COMPLETED', 'OK',
    { actual: row.state, details: { ...details, affected_rows: result.meta.changes } });
  if (next !== 'running') emit('d1', 'execution-final-read', 'D1_FINAL_READBACK_COMPLETED', 'OK', { actual: row.state });
  if (matched && result.meta.changes === 0) emit('d1', 'execution-transition', 'D1_EXECUTION_RECONCILED', 'OK', { actual: row.state });
  return row;
}
