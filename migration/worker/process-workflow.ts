import type { WorkflowStep } from 'cloudflare:workers';
import { PROCESSOR_INPUT_LIMIT, PROCESSOR_RESULT_LIMIT, processorResultKey } from '../processor-protocol.mjs';
import { classifyTraceError, traceStepName, type Trace, type TraceContext } from '../trace.mjs';
import { readExecution, transition, type Execution, type ExecutionBindings, type Terminal } from './execution-store';
import { isResult, processFile, ProcessingFailure, sha256 } from './processor';
import { observed, workerTrace } from './trace';

const POLICY = { retries: { limit: 2, delay: '2 seconds', backoff: 'exponential' }, timeout: '20 seconds' } as const;

export function processStep(env: ExecutionBindings, step: WorkflowStep, context: TraceContext, name: string) {
  return <T extends Rpc.Serializable<T>>(action: (emit: Trace) => Promise<T>,
    policy: typeof POLICY | { retries: { limit: number; delay: '5 seconds'; backoff: 'constant' }; timeout: '15 seconds' } = POLICY) =>
    step.do(name, policy, async (stepContext) => {
      const { emit, flush } = workerTrace(env.UPLOADS, { ...context, attempt: stepContext?.attempt });
      const stage = traceStepName(name);
      const started = Date.now();
      const details = { retry_limit: policy.retries.limit, backoff: policy.retries.backoff,
        timeout_ms: Number.parseInt(policy.timeout) * 1000, delay_ms: Number.parseInt(policy.retries.delay) * 1000 };
      emit('workflow', stage, 'WORKFLOW_STEP', 'STARTED', { expected: 'step-completed', details });
      try {
        const value = await action(emit);
        emit('workflow', stage, 'WORKFLOW_STEP', 'OK', { duration_ms: Date.now() - started });
        return value;
      } catch (error) {
        const classification = classifyTraceError(error);
        const safeCode = error instanceof Error ? /^(?:PROCESSOR_|DEPLOYED_VERSION_)[A-Z0-9_]{1,75}$/.exec(error.message)?.[0] : undefined;
        const errorCode = error instanceof ProcessingFailure ? error.code : safeCode
          ?? (classification === 'cpu_limit' ? 'WORKFLOW_CPU_LIMIT' : classification === 'memory_limit' ? 'WORKFLOW_MEMORY_LIMIT'
            : classification === 'timeout' ? 'WORKFLOW_STEP_TIMEOUT' : 'WORKFLOW_STEP_EXCEPTION');
        const canRetry = !(error instanceof Error && error.name === 'NonRetryableError')
          && (stepContext?.attempt ?? 1) <= policy.retries.limit;
        emit('workflow', stage, 'WORKFLOW_STEP', 'FAILED', { duration_ms: Date.now() - started,
          error_code: errorCode, details: { ...details, classification, can_retry: canRetry } });
        emit('workflow', stage, 'WORKFLOW_STEP_RETRY', canRetry ? 'RETRY' : 'SKIPPED', {
          error_code: errorCode, actual: canRetry ? 'retry-eligible' : 'permanent-or-exhausted' });
        // Provider errors can carry raw storage or SQL details. Workflow history
        // retains only the stable error code.
        if (error instanceof Error && error.name === 'NonRetryableError') throw error;
        throw new Error(errorCode);
      } finally {
        await flush();
      }
    });
}

async function readInput(bucket: R2Bucket, key: string, job: Execution, emit: Trace): Promise<ArrayBuffer> {
  const head = await observed(emit, 'r2', 'process-input-head', 'PROCESS_R2_HEAD', { expected: 'registered-object' },
    () => bucket.head(key), value => ({ actual: value ? 'object-found' : 'object-missing' }));
  if (!head) throw new ProcessingFailure('INPUT_MISSING');
  const matches = { size_matches: head.size === job.size, etag_matches: head.etag.toLowerCase() === job.etag,
    mime_matches: head.httpMetadata?.contentType === job.mime };
  emit('r2', 'process-input-metadata', 'PROCESS_R2_METADATA_CHECKED', Object.values(matches).every(Boolean) ? 'OK' : 'FAILED',
    { expected: 'registered-size-etag-mime', details: { ...matches, size: head.size, mime: head.httpMetadata?.contentType } });
  if (!matches.etag_matches) throw new ProcessingFailure('INPUT_ETAG_MISMATCH');
  if (!matches.size_matches || !matches.mime_matches) throw new ProcessingFailure('INPUT_METADATA_MISMATCH');
  if (head.size > PROCESSOR_INPUT_LIMIT) {
    emit('r2', 'process-input-size', 'PROCESS_R2_INPUT_LIMIT', 'FAILED', { error_code: 'PROCESSOR_INPUT_LIMIT',
      details: { size: head.size, expected_size: PROCESSOR_INPUT_LIMIT } });
    throw new ProcessingFailure('PROCESSOR_INPUT_LIMIT');
  }
  return observed(emit, 'r2', 'process-input-read', 'PROCESS_R2_INPUT_READ',
    { expected: 'exact-registered-bytes', details: { expected_size: job.size, offset: 0 } }, async () => {
      const object = await bucket.get(key, { onlyIf: new Headers({ 'If-Match': head.httpEtag }),
        range: { offset: 0, length: job.size } });
      if (!object) throw new ProcessingFailure('INPUT_MISSING');
      if (!('body' in object)) throw new ProcessingFailure('INPUT_ETAG_MISMATCH');
      if (object.etag.toLowerCase() !== job.etag) {
        await object.body.cancel();
        throw new ProcessingFailure('INPUT_ETAG_MISMATCH');
      }
      if (object.size !== job.size || object.httpMetadata?.contentType !== job.mime) {
        await object.body.cancel();
        throw new ProcessingFailure('INPUT_METADATA_MISMATCH');
      }
      const bytes = await object.arrayBuffer();
      if (bytes.byteLength !== job.size) throw new ProcessingFailure('INPUT_SIZE_MISMATCH');
      return bytes;
    }, bytes => ({ actual: 'exact-registered-bytes', details: { size: bytes.byteLength } }));
}

async function writeResult(bucket: R2Bucket, id: string, result: unknown, emit: Trace) {
  emit('r2', 'process-result-build', 'RESULT_BUILD_STARTED', 'STARTED');
  if (!isResult(result)) throw new ProcessingFailure('INVALID_RESULT_SCHEMA');
  const bytes = new TextEncoder().encode(JSON.stringify(result));
  emit('r2', 'process-result-build', 'RESULT_BUILD_COMPLETED', 'OK', { details: { size: bytes.byteLength } });
  if (bytes.byteLength > PROCESSOR_RESULT_LIMIT) throw new ProcessingFailure('RESULT_SIZE_LIMIT');
  emit('r2', 'process-result-size', 'RESULT_SIZE_VERIFIED', 'OK', { details: { size: bytes.byteLength } });
  const checksum = await sha256(bytes.buffer);
  emit('r2', 'process-result-digest', 'RESULT_SHA256_CALCULATED', 'OK');
  const key = processorResultKey(id);
  const started = Date.now();
  emit('r2', 'process-result-put', 'RESULT_R2_PUT_STARTED', 'STARTED');
  try {
    const written = await bucket.put(key, bytes, {
      onlyIf: new Headers({ 'If-None-Match': '*' }), httpMetadata: { contentType: 'application/json' },
    });
    emit('r2', 'process-result-put', 'RESULT_R2_PUT_COMPLETED', 'OK', { actual: written ? 'stored' : 'already-exists',
      duration_ms: Date.now() - started });
  } catch (error) {
    emit('r2', 'process-result-put', 'RESULT_R2_PUT_FAILED', 'RETRY', { error_code: 'RESULT_PUT_UNCONFIRMED',
      details: { classification: classifyTraceError(error) } });
    // A lost write response is resolved by the same independent readback.
  }
  emit('r2', 'process-result-readback', 'RESULT_R2_READBACK_STARTED', 'STARTED');
  const object = await observed(emit, 'r2', 'process-result-readback', 'RESULT_R2_READBACK', { expected: 'stored-result' },
    () => bucket.get(key, { range: { offset: 0, length: bytes.byteLength } }),
    value => ({ actual: value ? 'object-found' : 'object-missing', details: { size: value?.size } }));
  if (!object) throw new ProcessingFailure('RESULT_READBACK_MISSING', true);
  const sameSize = object.size === bytes.byteLength && object.httpMetadata?.contentType === 'application/json';
  const saved = sameSize ? await object.arrayBuffer() : (await object.body.cancel(), null);
  if (!saved || saved.byteLength !== bytes.byteLength || await sha256(saved) !== checksum) {
    emit('r2', 'process-result-readback', 'RESULT_CONFLICT_DETECTED', 'FAILED', { error_code: 'RESULT_CONFLICT' });
    throw new ProcessingFailure('RESULT_CONFLICT');
  }
  emit('r2', 'process-result-readback', 'RESULT_R2_READBACK_COMPLETED', 'OK', { details: { size: saved.byteLength } });
  emit('r2', 'process-result-digest', 'RESULT_CHECKSUM_VERIFIED', 'OK');
  return { state: 'succeeded', key, checksum } as const;
}

export async function runProcess(env: ExecutionBindings, step: WorkflowStep, id: string, context: TraceContext,
  ready: boolean): Promise<string> {
  const run = (name: string) => processStep(env, step, context, name);
  const start = async (emit: Trace) => {
    emit('workflow', 'process-payload', 'PROCESS_PAYLOAD_VALIDATED', 'OK', { actual: 'valid-process-operation' });
    emit('workflow', 'process-version', 'PROCESS_WORKER_VERSION', ready ? 'OK' : 'FAILED',
      { expected: 'matching-worker-version', error_code: ready ? undefined : 'DEPLOYED_VERSION_NOT_READY' });
    const existing = await readExecution(env.JOBS, id, emit);
    if (!existing) throw new ProcessingFailure('EXECUTION_MISSING');
    return existing.state === 'queued' ? transition(env.JOBS, id, 'running', emit) : existing;
  };
  const job = await run('Start processor execution')(start);
  if (job.state === 'succeeded') return job.resultKey ?? 'succeeded';
  if (job.state !== 'running') return job.state;

  let terminal: Terminal;
  try {
    const processed = await run('Read and process migration input')(async emit => {
      try {
        if (!ready) throw new ProcessingFailure('DEPLOYED_VERSION_NOT_READY');
        const bytes = await readInput(env.UPLOADS, 'uploads/' + id, job, emit);
        return await processFile(bytes, emit);
      } catch (error) {
        if (!(error instanceof ProcessingFailure) || error.retryable) throw error;
        emit('workflow', 'process-input-outcome', 'PROCESS_INPUT_REJECTED', 'FAILED',
          { error_code: error.code, details: { can_retry: false } });
        return { status: 'failed', errorCode: error.code } as const;
      }
    });
    if (processed.status !== 'succeeded') {
      terminal = { state: processed.status, code: processed.errorCode };
    } else {
      terminal = await run('Persist and verify migration result')(async emit => {
        try { return await writeResult(env.UPLOADS, id, processed, emit); }
        catch (error) {
          if (!(error instanceof ProcessingFailure) || error.retryable) throw error;
          return { state: 'failed', code: error.code } as const;
        }
      });
    }
  } catch (error) {
    const kind = classifyTraceError(error);
    terminal = { state: 'failed', code: kind === 'cpu_limit' ? 'WORKFLOW_CPU_LIMIT' : kind === 'memory_limit'
      ? 'WORKFLOW_MEMORY_LIMIT' : kind === 'timeout' ? 'WORKFLOW_STEP_TIMEOUT' : 'WORKFLOW_PROCESS_RETRIES_EXHAUSTED' };
  }
  const finalize = async (emit: Trace) => {
    await transition(env.JOBS, id, terminal, emit);
    emit('workflow', 'process-outcome', 'PROCESS_EXECUTION_COMPLETED', terminal.state === 'failed' ? 'FAILED' : 'OK',
      { actual: terminal.state, error_code: terminal.state === 'succeeded' ? undefined : terminal.code });
    return terminal.state === 'succeeded' ? terminal.key : terminal.state;
  };
  try { return await run('Finalize processor execution')(finalize); }
  catch { return run('Reconcile processor execution')(finalize); }
}
