import type { WorkflowStep } from 'cloudflare:workers';
import { FIXTURE_FORMAT, PROCESSOR_INPUT_LIMIT, PROCESSOR_RECORD_LIMIT, PROCESSOR_VERSION, processorInstanceId, processorResultKey } from '../processor-protocol.mjs';
import type { Trace, TraceContext } from '../trace.mjs';
import { readExecution } from './execution-store';
import { processStep, readResultBytes } from './process-workflow';
import { isResult, ProcessingFailure, sha256, type Success } from './processor';
import { UPLOAD_BUCKET } from './r2-upload';
import type { SmokeBindings } from './smoke';
import { observed } from './trace';
import { NESTED_FORMAT } from './processor/adapters/nested';

const CONTENT_TYPE = 'application/octet-stream';
const WAIT = { retries: { limit: 7, delay: '5 seconds', backoff: 'constant' }, timeout: '15 seconds' } as const;
const READY = 'MIGRATION_PROCESSOR_READY:';

export async function processorReadiness(env: SmokeBindings, step: WorkflowStep, context: TraceContext) {
  return processStep(env, step, context, 'Check processor runtime version')(async emit => {
    const version = env.MIGRATION_VERSION?.id;
    emit('workflow', 'processor-readiness', 'PROCESSOR_READINESS', version ? 'OK' : 'FAILED',
      { expected: 'runtime-worker-version', actual: version ? 'version-confirmed' : 'version-missing' });
    return READY + (version ?? 'unavailable');
  });
}

function smokeFixture(scenario: 'fixture' | 'nested') {
  if (scenario === 'nested') {
    const fixture = { format: NESTED_FORMAT, container: { groups: [
      { sourceId: 'z', items: [{ sourceId: 'c', amount: 9, peerId: 'a' }] },
      { sourceId: 'a-group', items: [
        { sourceId: 'b', amount: -4, peerId: 'c' }, { sourceId: 'a', amount: 17, peerId: null },
      ] },
      { sourceId: 'm', items: [] },
    ] } };
    const expected = { groups: [{ id: 'a-group' }, { id: 'm' }, { id: 'z' }], items: [
      { id: 'a', group: 'a-group', value: 17, ref: null },
      { id: 'b', group: 'a-group', value: -4, ref: 'c' },
      { id: 'c', group: 'z', value: 9, ref: 'a' },
    ] };
    return { bytes: new TextEncoder().encode(JSON.stringify(fixture)), count: 3,
      adapterId: 'synthetic-nested', verified: 'MIGRATION_NESTED_SMOKE_VERIFIED',
      matches: (result: Success) => result.schemaVersion === 2 && result.processorVersion === 'v1'
        && result.detectedFormat === NESTED_FORMAT && result.adapter.id === 'synthetic-nested'
        && result.adapter.version === '1.0.0' && result.summary.warningsCount === 1
        && result.warnings.length === 1 && result.warnings[0] === 'EMPTY_GROUP'
        && JSON.stringify(result.normalized) === JSON.stringify(expected) };
  }
  const records = Array.from({ length: PROCESSOR_RECORD_LIMIT }, (_, value) => ({ value }));
  const fixture = JSON.stringify({ format: FIXTURE_FORMAT, records });
  return { bytes: new TextEncoder().encode(fixture.padEnd(PROCESSOR_INPUT_LIMIT, ' ')), count: PROCESSOR_RECORD_LIMIT,
    adapterId: 'synthetic-fixture', verified: 'MIGRATION_PROCESSOR_SMOKE_VERIFIED',
    matches: (result: Success) => result.schemaVersion === 1 && result.detectedFormat === FIXTURE_FORMAT };
}

export async function runProcessorSmoke(env: SmokeBindings, id: string, step: WorkflowStep, context: TraceContext,
  version: string, permanent: (code: string) => Error, scenario: 'fixture' | 'nested' = 'fixture') {
  const run = (name: string) => processStep(env, step, context, name);
  const fixture = smokeFixture(scenario);
  const { bytes } = fixture;
  const key = 'uploads/' + id;
  await run('Upload processor fixture')(async emit => {
    if (env.MIGRATION_VERSION?.id !== version) throw permanent('DEPLOYED_VERSION_NOT_READY');
    const written = await env.UPLOADS.put(key, bytes, {
      onlyIf: new Headers({ 'If-None-Match': '*' }), httpMetadata: { contentType: CONTENT_TYPE },
      customMetadata: { processorSmoke: id, workerVersion: version, ...(context.run_id ? { runId: context.run_id } : {}) },
    });
    const object = written ?? await env.UPLOADS.head(key);
    if (object?.customMetadata?.processorSmoke !== id || object.customMetadata.workerVersion !== version
      || object.size !== bytes.byteLength || object.httpMetadata?.contentType !== CONTENT_TYPE) {
      throw permanent('PROCESSOR_SMOKE_INPUT_CONFLICT');
    }
    emit('r2', 'processor-smoke-upload', 'PROCESSOR_SMOKE_PUT', 'OK', { details: { size: bytes.byteLength } });
  });

  const completed = await run('Observe processor execution')(async emit => {
    const execution = await readExecution(env.JOBS, id, emit);
    if (execution?.state === 'failed' || execution?.state === 'unsupported') throw permanent('PROCESSOR_SMOKE_EXECUTION_REJECTED');
    if (execution?.state !== 'succeeded') throw new Error('PROCESSOR_SMOKE_EXECUTION_PENDING');
    return execution;
  }, WAIT);

  await run('Verify processor fixture result')(async emit => {
    const saved = await readResultBytes(env.UPLOADS, id, emit);
    if (!saved) throw new Error('PROCESSOR_SMOKE_RESULT_MISSING');
    const parsed: unknown = JSON.parse(new TextDecoder().decode(saved));
    if (!isResult(parsed) || parsed.inputSizeBytes !== bytes.byteLength || parsed.inputSha256 !== await sha256(bytes.buffer)
      || !fixture.matches(parsed) || parsed.summary.recordsValidated !== fixture.count || await sha256(saved) !== completed.checksum || completed.attempts !== 1) {
      throw permanent('PROCESSOR_SMOKE_RESULT_INVALID');
    }
    emit('processor', 'adapter-selection', 'PROCESSOR_SMOKE_ADAPTER_VERIFIED', 'OK',
      { details: { adapter_id: fixture.adapterId, adapter_version: '1.0.0' } });
    emit('r2', 'processor-smoke-result', 'PROCESSOR_SMOKE_INPUT_CHECKSUM_VERIFIED', 'OK');
    emit('r2', 'processor-smoke-result', 'PROCESSOR_SMOKE_RESULT_CHECKSUM_VERIFIED', 'OK');
    emit('r2', 'processor-smoke-result', 'PROCESSOR_SMOKE_RESULT_VERIFIED', 'OK', { details: { count: fixture.count, size: saved.byteLength } });
  });

  await run('Replay processor queue event')(async emit => {
    const row = await env.JOBS.prepare('SELECT event_at, event_action FROM migration_jobs WHERE id = ?').bind(key).first();
    if (typeof row?.event_at !== 'string' || !Number.isFinite(Date.parse(row.event_at)) || row.event_action !== 'PutObject') {
      throw permanent('PROCESSOR_SMOKE_EVENT_INVALID');
    }
    await env.EVENTS.send({ account: env.CLOUDFLARE_ACCOUNT_ID, bucket: UPLOAD_BUCKET, action: row.event_action,
      object: { key, size: completed.size, eTag: completed.etag }, eventTime: row.event_at, processorReplay: id });
    emit('queue', 'processor-smoke-replay', 'PROCESSOR_SMOKE_REPLAY_SENT', 'OK');
  });

  await run('Verify processor replay receipt')(async emit => {
    const receipt = await env.JOBS.prepare('SELECT replay_id FROM migration_smoke_replays WHERE replay_id = ? AND object_key = ?')
      .bind(id, key).first();
    if (receipt?.replay_id !== id) throw new Error('PROCESSOR_SMOKE_REPLAY_PENDING');
    const current = await readExecution(env.JOBS, id, emit);
    const saved = await readResultBytes(env.UPLOADS, id, emit);
    if (current?.state !== 'succeeded' || current.attempts !== completed.attempts || current.checksum !== completed.checksum
      || !saved || await sha256(saved) !== completed.checksum) {
      throw permanent('PROCESSOR_SMOKE_REPLAY_CHANGED_RESULT');
    }
    emit('d1', 'processor-smoke-replay', 'PROCESSOR_SMOKE_REPLAY_VERIFIED', 'OK');
  }, WAIT);
  return fixture.verified;
}

async function readCleanupRows(db: D1Database, id: string, key: string, emit: Trace, readback: boolean) {
  return observed(emit, 'd1', 'processor-cleanup-rows',
    readback ? 'PROCESSOR_CLEANUP_D1_READBACK' : 'PROCESSOR_CLEANUP_D1_SCOPE',
    { details: { sql: 'SELECT' } }, async () => {
      const [jobs, executions, replays] = await db.batch<Record<string, unknown>>([
        db.prepare(`SELECT id, object_key, object_etag, object_size, content_type, state
          FROM migration_jobs WHERE id = ? OR object_key = ? LIMIT 2`).bind(key, key),
        db.prepare(`SELECT job_id, object_key, object_etag, processor_version, workflow_id, state
          FROM migration_executions WHERE job_id = ? OR object_key = ? OR workflow_id = ? LIMIT 2`).bind(key, key, processorInstanceId(id)),
        db.prepare('SELECT replay_id, object_key FROM migration_smoke_replays WHERE replay_id = ? OR object_key = ? LIMIT 2').bind(id, key),
      ]);
      if (!jobs?.success || !executions?.success || !replays?.success) throw new Error('PROCESSOR_CLEANUP_D1_UNAVAILABLE');
      const tables = {
        migration_jobs: jobs.results,
        migration_executions: executions.results,
        migration_smoke_replays: replays.results,
      };
      for (const [table, rows] of Object.entries(tables)) {
        emit('d1', 'processor-cleanup-rows', readback ? 'PROCESSOR_CLEANUP_D1_TABLE' : 'PROCESSOR_CLEANUP_D1_SCOPE_TABLE',
          readback && rows.length ? 'FAILED' : 'OK',
          { actual: rows.length ? 'rows-present' : 'rows-absent', details: { table, sql: 'SELECT' } });
      }
      return tables;
    }, rows => {
      const present = Object.values(rows).some(table => table.length > 0);
      return { actual: present ? 'rows-present' : 'rows-absent',
        error_code: readback && present ? 'PROCESSOR_CLEANUP_D1_UNCONFIRMED' : undefined };
    });
}

function cleanupHead(bucket: R2Bucket, key: string, emit: Trace, kind: 'input' | 'result', readback = false) {
  return observed(emit, 'r2', 'processor-cleanup-' + kind,
    readback ? 'PROCESSOR_CLEANUP_R2_READBACK' : 'PROCESSOR_CLEANUP_R2_HEAD',
    { expected: readback ? 'object-absent' : 'head-result' }, () => bucket.head(key),
    object => ({ actual: object ? 'object-present' : 'object-absent',
      error_code: readback && object ? 'PROCESSOR_CLEANUP_R2_UNCONFIRMED' : undefined }));
}

function cleanupResults(bucket: R2Bucket, id: string, resultKey: string, emit: Trace, readback: boolean) {
  return observed(emit, 'r2', 'processor-cleanup-results', 'PROCESSOR_CLEANUP_R2_LIST',
    { expected: readback ? 'results-absent' : 'only-current-result-key' }, async () => {
      // The trailing slash keeps the listing inside this job's namespace.
      const { objects, truncated } = await bucket.list({ prefix: 'results/' + id + '/', limit: 2 });
      return { present: objects.length > 0, conflict: truncated || objects.some(object => object.key !== resultKey) };
    }, results => ({ actual: results.conflict ? 'unexpected-result-key' : results.present ? 'result-present' : 'results-absent',
      error_code: readback && results.present ? 'PROCESSOR_CLEANUP_R2_UNCONFIRMED'
        : results.conflict ? 'PROCESSOR_CLEANUP_RESULT_CONFLICT' : undefined }));
}

async function readCleanupResources(env: SmokeBindings, id: string, key: string, resultKey: string, emit: Trace, readback = false) {
  const checks = [
    cleanupHead(env.UPLOADS, key, emit, 'input', readback),
    cleanupHead(env.UPLOADS, resultKey, emit, 'result', readback),
    cleanupResults(env.UPLOADS, id, resultKey, emit, readback),
    readCleanupRows(env.JOBS, id, key, emit, readback),
  ] as const;
  // Let both sources record their observations before the step flushes its trace.
  await Promise.allSettled(checks);
  return Promise.all(checks);
}

async function removeCleanupObject(bucket: R2Bucket, key: string, verified: R2Object | null, emit: Trace,
  kind: 'input' | 'result', permanent: (code: string) => Error) {
  const stage = 'processor-cleanup-' + kind;
  const event = 'PROCESSOR_CLEANUP_R2_DELETE';
  if (!verified) {
    emit('r2', stage, event, 'SKIPPED', { actual: 'already-absent' });
    return;
  }
  // The Workers binding has no conditional DELETE. Recheck the R2 version
  // immediately before deletion and only send a delete for a verified object.
  const current = await cleanupHead(bucket, key, emit, kind);
  if (!current) {
    emit('r2', stage, event, 'SKIPPED', { actual: 'already-absent' });
    return;
  }
  if (current.version !== verified.version || current.etag !== verified.etag) {
    emit('r2', stage, event, 'FAILED', { actual: 'object-changed', error_code: 'PROCESSOR_CLEANUP_SCOPE_INVALID' });
    throw permanent('PROCESSOR_CLEANUP_SCOPE_INVALID');
  }
  await observed(emit, 'r2', stage, event, { expected: 'delete-accepted' }, () => bucket.delete(key),
    () => ({ actual: 'delete-accepted' }));
  if (await cleanupHead(bucket, key, emit, kind, true)) throw new Error('PROCESSOR_CLEANUP_R2_UNCONFIRMED');
  emit('r2', stage, 'PROCESSOR_CLEANUP_R2_REMOVED', 'OK', { actual: 'removed' });
}

export async function cleanupProcessorSmoke(env: SmokeBindings, id: string, step: WorkflowStep, context: TraceContext,
  permanent: (code: string) => Error) {
  const key = 'uploads/' + id;
  const resultKey = processorResultKey(id);
  return processStep(env, step, context, 'Verify and remove processor smoke resources')(async emit => {
    const scope = 'processor-smoke-cleanup';
    const failScope = (code: string, actual: string) => {
      emit('cleanup', scope, 'PROCESSOR_CLEANUP_SCOPE', 'FAILED', { error_code: code, actual });
      return permanent(code);
    };
    emit('cleanup', scope, 'PROCESSOR_CLEANUP_SCOPE', 'STARTED');
    const [input, result, results, rows] = await readCleanupResources(env, id, key, resultKey, emit);
    if (!input) {
      if (result || results.present || results.conflict || Object.values(rows).some(table => table.length > 0)) {
        throw failScope('PROCESSOR_CLEANUP_INCOMPLETE', 'fixture-missing-with-residue');
      }
      emit('cleanup', scope, 'PROCESSOR_CLEANUP_SCOPE', 'SKIPPED', { actual: 'all-resources-absent' });
      emit('cleanup', scope, 'PROCESSOR_SMOKE_CLEANUP', 'OK', { actual: 'already-absent' });
      return 'MIGRATION_PROCESSOR_CLEANUP_OK';
    }
    if (input.customMetadata?.processorSmoke !== id) {
      throw failScope('PROCESSOR_CLEANUP_SCOPE_INVALID', 'fixture-marker-mismatch');
    }
    const etag = input.etag.toLowerCase();
    if (rows.migration_jobs.some(row => row.id !== key || row.object_key !== key || row.object_etag !== etag
        || row.object_size !== input.size || (row.state === 'uploaded' && row.content_type !== input.httpMetadata?.contentType))
      || rows.migration_executions.some(row => row.job_id !== key || row.object_key !== key || row.object_etag !== etag
        || row.processor_version !== PROCESSOR_VERSION || row.workflow_id !== processorInstanceId(id))
      || rows.migration_smoke_replays.some(row => row.replay_id !== id || row.object_key !== key)) {
      throw failScope('PROCESSOR_CLEANUP_SCOPE_INVALID', 'd1-ownership-conflict');
    }
    if (rows.migration_executions.some(row => row.state === 'queued' || row.state === 'running')) {
      emit('cleanup', scope, 'PROCESSOR_CLEANUP_SCOPE', 'FAILED',
        { actual: 'execution-active', error_code: 'PROCESSOR_CLEANUP_EXECUTION_ACTIVE' });
      throw new Error('PROCESSOR_CLEANUP_EXECUTION_ACTIVE');
    }

    if (results.conflict || results.present !== Boolean(result)) {
      throw failScope('PROCESSOR_CLEANUP_RESULT_CONFLICT', 'result-namespace-conflict');
    }
    const execution = rows.migration_executions.length ? await readExecution(env.JOBS, id, emit) : null;
    if (rows.migration_executions.length && !execution) {
      throw failScope('PROCESSOR_CLEANUP_SCOPE_INVALID', 'execution-readback-missing');
    }
    if (result) {
      await observed(emit, 'r2', 'processor-cleanup-result', 'PROCESSOR_CLEANUP_RESULT_VERIFY',
        { expected: 'verified-result-checksum' }, async () => {
          try {
            const saved = await readResultBytes(env.UPLOADS, id, emit);
            if (saved && execution?.state === 'succeeded' && await sha256(saved) === execution.checksum) return;
          } catch (error) {
            if (!(error instanceof ProcessingFailure) || error.code !== 'RESULT_CONFLICT') throw error;
          }
          throw failScope('PROCESSOR_CLEANUP_RESULT_CONFLICT', 'result-integrity-conflict');
        });
    } else {
      emit('r2', 'processor-cleanup-result', 'PROCESSOR_CLEANUP_RESULT_VERIFY', 'SKIPPED', { actual: 'already-absent' });
    }
    emit('cleanup', scope, 'PROCESSOR_CLEANUP_SCOPE', 'OK', { actual: 'ownership-confirmed' });

    // Keep the input ownership marker until the verified result is gone.
    await removeCleanupObject(env.UPLOADS, resultKey, result, emit, 'result', permanent);
    await removeCleanupObject(env.UPLOADS, key, input, emit, 'input', permanent);
    await observed(emit, 'd1', 'processor-cleanup-delete', 'PROCESSOR_CLEANUP_D1_DELETE',
      { expected: 'committed', details: { sql: 'BATCH' } }, async () => {
        const deleted = await env.JOBS.batch([
          env.JOBS.prepare(`DELETE FROM migration_smoke_replays WHERE replay_id = ? AND object_key = ?
            AND NOT EXISTS (SELECT 1 FROM migration_executions WHERE job_id = ? AND state IN ('queued', 'running'))`).bind(id, key, key),
          env.JOBS.prepare(`DELETE FROM migration_executions WHERE job_id = ? AND object_key = ? AND object_etag = ?
            AND processor_version = ? AND workflow_id = ? AND state IN ('succeeded', 'failed', 'unsupported')`)
            .bind(key, key, etag, PROCESSOR_VERSION, processorInstanceId(id)),
          // Avoid cascading into an execution that appeared or changed after the scope check.
          env.JOBS.prepare(`DELETE FROM migration_jobs WHERE id = ? AND object_key = ? AND object_etag = ? AND object_size = ?
            AND NOT EXISTS (SELECT 1 FROM migration_executions WHERE job_id = ?)
            AND NOT EXISTS (SELECT 1 FROM migration_smoke_replays WHERE object_key = ?)`).bind(key, key, etag, input.size, key, key),
        ]);
        if (deleted.length !== 3 || deleted.some(statement => !statement.success)) {
          throw new Error('PROCESSOR_CLEANUP_D1_UNCONFIRMED');
        }
      }, () => ({ actual: 'committed' }));
    const [remainingInput, remainingResult, remainingResults, remainingRows] =
      await readCleanupResources(env, id, key, resultKey, emit, true);
    if (remainingInput || remainingResult || remainingResults.present || remainingResults.conflict) {
      throw new Error('PROCESSOR_CLEANUP_R2_UNCONFIRMED');
    }
    if (Object.values(remainingRows).some(table => table.length > 0)) {
      throw new Error('PROCESSOR_CLEANUP_D1_UNCONFIRMED');
    }
    emit('cleanup', scope, 'PROCESSOR_SMOKE_CLEANUP', 'OK', { actual: 'removed' });
    return 'MIGRATION_PROCESSOR_CLEANUP_OK';
  });
}
