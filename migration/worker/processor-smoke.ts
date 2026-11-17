import type { WorkflowStep } from 'cloudflare:workers';
import { FIXTURE_FORMAT, PROCESSOR_INPUT_LIMIT, PROCESSOR_RECORD_LIMIT, PROCESSOR_RESULT_LIMIT, processorResultKey } from '../processor-protocol.mjs';
import type { TraceContext } from '../trace.mjs';
import { readExecution } from './execution-store';
import { processStep } from './process-workflow';
import { isResult, sha256 } from './processor';
import { UPLOAD_BUCKET } from './r2-upload';
import type { SmokeBindings } from './smoke';

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

export async function runProcessorSmoke(env: SmokeBindings, id: string, step: WorkflowStep, context: TraceContext,
  version: string, permanent: (code: string) => Error) {
  const run = (name: string) => processStep(env, step, context, name);
  // Fill the configured input-size boundary with ASCII JSON whitespace. The
  // processor and smoke verify the checksum of every byte, including padding.
  const records = Array.from({ length: PROCESSOR_RECORD_LIMIT }, (_, value) => ({ value }));
  const fixture = JSON.stringify({ format: FIXTURE_FORMAT, records });
  const bytes = new TextEncoder().encode(fixture.padEnd(PROCESSOR_INPUT_LIMIT, ' '));
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
    const result = await env.UPLOADS.get(processorResultKey(id), { range: { offset: 0, length: PROCESSOR_RESULT_LIMIT } });
    if (!result || result.size > PROCESSOR_RESULT_LIMIT) throw new Error('PROCESSOR_SMOKE_RESULT_MISSING');
    const saved = await result.arrayBuffer();
    const parsed: unknown = JSON.parse(new TextDecoder().decode(saved));
    if (!isResult(parsed) || parsed.inputSizeBytes !== bytes.byteLength || parsed.inputSha256 !== await sha256(bytes.buffer)
      || parsed.summary.recordsValidated !== PROCESSOR_RECORD_LIMIT || await sha256(saved) !== completed.checksum || completed.attempts !== 1) {
      throw permanent('PROCESSOR_SMOKE_RESULT_INVALID');
    }
    emit('r2', 'processor-smoke-result', 'PROCESSOR_SMOKE_RESULT_VERIFIED', 'OK', { details: { count: PROCESSOR_RECORD_LIMIT, size: saved.byteLength } });
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
    if (current?.state !== 'succeeded' || current.attempts !== completed.attempts || current.checksum !== completed.checksum) {
      throw permanent('PROCESSOR_SMOKE_REPLAY_CHANGED_RESULT');
    }
    emit('d1', 'processor-smoke-replay', 'PROCESSOR_SMOKE_REPLAY_VERIFIED', 'OK');
  }, WAIT);
  return 'MIGRATION_PROCESSOR_SMOKE_VERIFIED';
}

export async function cleanupProcessorSmoke(env: SmokeBindings, id: string, step: WorkflowStep, context: TraceContext,
  permanent: (code: string) => Error) {
  const run = (name: string) => processStep(env, step, context, name);
  const key = 'uploads/' + id;
  const verified = await run('Check processor cleanup scope')(async emit => {
    const object = await env.UPLOADS.head(key);
    if (!object) {
      emit('cleanup', 'processor-smoke-cleanup', 'PROCESSOR_CLEANUP_SCOPE', 'SKIPPED', { actual: 'fixture-missing' });
      return false;
    }
    if (object.customMetadata?.processorSmoke !== id) throw permanent('PROCESSOR_CLEANUP_SCOPE_INVALID');
    const execution = await readExecution(env.JOBS, id, emit);
    if (execution?.state === 'running' || execution?.state === 'queued') throw new Error('PROCESSOR_CLEANUP_EXECUTION_ACTIVE');
    return true;
  });
  if (verified) await run('Remove processor smoke objects')(async emit => {
    const resultKey = processorResultKey(id);
    await env.UPLOADS.delete([key, resultKey]);
    const objects = await Promise.all([env.UPLOADS.head(key), env.UPLOADS.head(resultKey)]);
    if (objects.some(Boolean)) throw new Error('PROCESSOR_CLEANUP_R2_UNCONFIRMED');
    const statements = await env.JOBS.batch([
      env.JOBS.prepare('DELETE FROM migration_smoke_replays WHERE replay_id = ? AND object_key = ?').bind(id, key),
      env.JOBS.prepare('DELETE FROM migration_executions WHERE job_id = ?').bind(key),
      env.JOBS.prepare('DELETE FROM migration_jobs WHERE id = ?').bind(key),
    ]);
    if (statements.some(statement => !statement.success)
      || await env.JOBS.prepare('SELECT id FROM migration_jobs WHERE id = ?').bind(key).first()) {
      throw new Error('PROCESSOR_CLEANUP_D1_UNCONFIRMED');
    }
    emit('cleanup', 'processor-smoke-cleanup', 'PROCESSOR_SMOKE_CLEANUP', 'OK', { actual: 'removed' });
  });
  return 'MIGRATION_PROCESSOR_CLEANUP_OK';
}
