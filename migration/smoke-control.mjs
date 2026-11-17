import { workflowStepName } from './trace-collector.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

const WORKFLOW = 'mezfit-migration-workflow';
const INSTANCES = '/workflows/' + WORKFLOW + '/instances';
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const KNOWN_STEPS = new Set([
  'check signed upload and bucket privacy', 'observe R2 event in D1', 'replay original R2 event',
  'verify idempotent replay in D1', 'delete synthetic backup',
  'Sweep expired smoke objects', 'Upload signed R2 backup', 'Verify R2 HEAD', 'Observe R2 notification in D1',
  'Replay R2 event via Queue', 'Verify exact Queue replay receipt', 'Reject signed PUT mime', 'Reject signed PUT length',
  'Reject signed PUT conditional', 'Reject signed PUT expired', 'Reject conditional overwrite', 'Reject anonymous R2 GET',
  'Delete current smoke objects', 'Delete failed smoke objects',
]);
const PASSED = [
  'SigV4 PUT and exact R2 HEAD', 'R2 → Queue → D1 registration', 'Exact replay receipt and unchanged job',
  'Changed MIME, length and conditional header rejected', 'Expired signature rejected',
  'Overwrite and anonymous read rejected', 'Synthetic object cleanup',
];
const ACTIVE = new Set(['queued', 'running', 'waiting', 'waitingForPause', 'rollingBack']);
const STATUS = new Set([...ACTIVE, 'complete', 'errored', 'terminated', 'paused', 'canceled', 'cancelled', 'failed']);
const SAFE_CODES = new Set([
  'SMOKE_WORKFLOW_INPUT_INVALID', 'SMOKE_BINDINGS_INVALID', 'MIGRATION_WORKFLOW_UNSUPPORTED_OPERATION',
  'SMOKE_SIGNED_PUT_REQUEST_FAILED', 'SMOKE_SIGNED_PUT_TTL_MISMATCH', 'SMOKE_SIGNED_PUT_HEADER_CHECK_FAILED',
  'SMOKE_EXPIRED_PUT_CHECK_FAILED', 'SMOKE_SIGNED_PUT_FAILED', 'SMOKE_WRITE_ONCE_OR_HEAD_FAILED',
  'SMOKE_ANONYMOUS_READ_REQUEST_FAILED', 'SMOKE_ANONYMOUS_READ_ALLOWED',
  'SMOKE_R2_EVENT_NOT_REGISTERED', 'SMOKE_EVENT_REPLAY_NOT_OBSERVED',
  'SMOKE_R2_TRANSPORT', 'SMOKE_SIGNER_FAILED', 'SMOKE_R2_HEAD_FAILED', 'SMOKE_UPLOAD_KEY_OCCUPIED',
  'SMOKE_BAD_PUT_CREATED_OBJECT', 'SMOKE_INVALID_MIME_ACCEPTANCE', 'SMOKE_INVALID_LENGTH_ACCEPTANCE',
  'SMOKE_INVALID_CONDITIONAL_ACCEPTANCE', 'SMOKE_INVALID_EXPIRED_ACCEPTANCE', 'SMOKE_D1_JOB_READ_FAILED',
  'SMOKE_CLEANUP_SCOPE_INVALID', 'SMOKE_R2_CLEANUP_FAILED', 'SMOKE_R2_SWEEP_FAILED', 'SMOKE_UNEXPECTED_RUNTIME',
  'SMOKE_HEAD_MISMATCH', 'SMOKE_D1_EVENT_PENDING', 'SMOKE_D1_EVENT_MISMATCH', 'SMOKE_QUEUE_SEND_FAILED',
  'SMOKE_D1_RECEIPT_READ_FAILED', 'SMOKE_QUEUE_REPLAY_PENDING', 'SMOKE_QUEUE_REPLAY_MISMATCH',
  'SMOKE_OVERWRITE_NOT_REJECTED', 'SMOKE_PUBLIC_READ_NOT_REJECTED',
  'SMOKE_EXPIRY_CONTROL_MISMATCH', 'SMOKE_EXPIRY_CONTROL_PUT_FAILED', 'SMOKE_EXPIRY_FRESH_CONTROL_FAILED',
  'SMOKE_OVERWRITE_CONTROL_MISSING', 'SMOKE_OVERWRITE_CHANGED_OBJECT',
]);
const SAFE_LABELS = new Set([
  's3-response', 'network-or-timeout', 'configured-signer-and-valid-ttl', 'signer-unavailable',
  'r2-head-response', 'r2-head-rejected', 'empty-or-own-backup', 'unexpected-object', 'http-200',
  'probe-object-absent', 'probe-object-present', 'expired-signature', 'signature-rejection',
  'd1-read-response', 'd1-query-rejected', 'd1-schema-or-access-invalid', 'configured-worker-bindings',
  'missing-uploads-binding', 'missing-jobs-binding', 'missing-events-binding', 'synthetic-smoke-keys', 'unexpected-key',
  'synthetic-objects-removed', 'r2-delete-rejected', 'synthetic-prefix-list', 'r2-list-rejected',
  'operation-completed', 'type-error', 'range-error', 'runtime-error', 'exact-size-type-etag',
  'metadata-mismatch', 'object-missing', 'registered-put-event', 'job-missing',
  'OBJECT_MISSING', 'OBJECT_MISMATCH', 'INVALID_BACKUP_METADATA', 'replay-accepted', 'queue-send-rejected',
  'exact-replay-receipt', 'receipt-missing', 'unchanged-job-and-valid-receipt', 'job-or-receipt-mismatch',
  'http-412-PreconditionFailed', 'anonymous-access-denied', 'isolated-smoke-object', 'short-expiry', 'unexpected-ttl',
  'valid-put-before-expiry', 'baseline-unverified', 'empty-probe-key', 'same-url-after-expiry', 'expiry-control-unverified',
  'existing-backup', 'backup-unverified', 'unchanged-object-version', 'object-changed', 'smoke-payload-and-uuid', 'invalid-input',
]);
const S3_LABEL = /^http-[1-5]\d\d-(?:AccessDenied|Unauthorized|SignatureDoesNotMatch|InvalidArgument|AuthorizationQueryParametersError|AuthorizationHeaderMalformed|InvalidToken|ExpiredToken|RequestExpired|RequestTimeTooSkewed|PreconditionFailed|ConditionalRequestConflict|MissingContentLength|InvalidAccessKeyId|SlowDown|ServiceUnavailable|NoSuchKey|NoSuchBucket|UnknownS3Code)$/;
const CATEGORIES = new Set(['configuration', 'authentication', 'runtime', 'transient', 'storage', 'integrity', 'http', 'delivery']);

function safeLabel(value) {
  return SAFE_LABELS.has(value) || S3_LABEL.test(value ?? '') ? value : 'unavailable';
}

function safeStatus(value) { return STATUS.has(value) ? value : 'unknown'; }

function summarizeError(error) {
  const raw = typeof error?.message === 'string' ? error.message : '';
  const parts = /(?:^|[:\s])(SMOKE_[A-Z0-9_]+|MIGRATION_WORKFLOW_UNSUPPORTED_OPERATION)(?:\|([a-z]+)\|([-\w]+)\|([-\w]+))?/.exec(raw);
  if (parts && SAFE_CODES.has(parts[1])) {
    return {
      category: CATEGORIES.has(parts[2]) ? parts[2] : 'smoke',
      code: parts[1], expected: safeLabel(parts[3]), actual: safeLabel(parts[4]),
      cause: parts[1] === 'MIGRATION_WORKFLOW_UNSUPPORTED_OPERATION'
        ? 'Workflow rejected its input before executing a smoke step'
        : 'Smoke operation rejected the observed result',
    };
  }
  const kinds = { TypeError: 'runtime', ReferenceError: 'runtime', RangeError: 'runtime',
    TimeoutError: 'timeout', AbortError: 'interrupted', NonRetryableError: 'permanent' };
  const kind = Object.hasOwn(kinds, error?.name) ? error.name : 'Error';
  const trace = raw ? ' (message fingerprint ' + createHash('sha256').update(raw).digest('hex').slice(0, 12) + ')' : '';
  const cause = /timed? ?out|deadline exceeded/i.test(raw) ? 'Cloudflare reported a timeout'
    : /D1_ERROR|no such table/i.test(raw) ? 'Cloudflare reported a D1 error'
      : /not authorized|permission denied|forbidden/i.test(raw) ? 'Cloudflare reported an authorization error'
        : /fetch failed|network|connection reset/i.test(raw) ? 'Cloudflare reported a transport error'
          : raw ? 'Cloudflare reported an exception outside the smoke error contract' : 'No error detail was retained by Cloudflare';
  return { category: kinds[kind] ?? 'cloudflare', code: 'WORKFLOW_' + kind.toUpperCase(),
    expected: 'operation completed', actual: kind, cause: cause + trace };
}

function stepState(step) {
  if (step?.success === true || step?.success === false) return step.success ? 'passed' : 'failed';
  if (step?.outcome === 'complete' || step?.outcome === 'failed') return step.outcome === 'complete' ? 'passed' : 'failed';
  if (['sleep', 'waitForEvent'].includes(step?.type) && step.end) return 'completed';
  return 'incomplete';
}

export function describeSmoke(id, instance, reason) {
  const steps = Array.isArray(instance?.steps) ? instance.steps : [];
  const failed = steps.filter(step => stepState(step) === 'failed');
  // Cleanup must not hide the primary failure, and the last retry belongs to the failed step.
  const failure = failed.find(step => step?.name !== 'Delete current smoke objects') ?? failed[0]
    ?? steps.findLast(step => stepState(step) !== 'passed' && Array.isArray(step?.attempts) && step.attempts.at(-1)?.success === false);
  const attempts = Array.isArray(failure?.attempts) ? failure.attempts : [];
  const attempt = attempts.at(-1);
  const status = safeStatus(instance?.status);
  const result = status === 'complete' && !reason ? 'PASSED' : ACTIVE.has(status) && !reason ? 'IN PROGRESS' : 'FAILED';
  const detail = reason
    ? { category: 'control-plane', code: reason, expected: 'complete with MIGRATION_SMOKE_OK', actual: status,
      cause: 'The Actions smoke runner could not verify successful completion' }
    : summarizeError(attempt?.error ?? failure?.error ?? instance?.error);
  const lines = [
    'Migration Smoke: ' + result, 'Workflow: ' + WORKFLOW, 'Instance: ' + id, 'Status: ' + status,
  ];
  if (result === 'FAILED') lines.push(
    'Failed step: ' + (failure ? (workflowStepName(failure.name) ?? (KNOWN_STEPS.has(failure.name) ? failure.name : 'unnamed recorded step')) : 'before step execution or unavailable'),
    'Attempt: ' + (attempts.length || 'unavailable'),
    'Error category: ' + detail.category, 'Error code: ' + detail.code, 'Expected: ' + detail.expected,
    'Actual: ' + detail.actual, 'Cause: ' + detail.cause,
  );
  for (const [index, step] of steps.slice(0, 50).entries()) {
    const name = workflowStepName(step?.name) ?? (KNOWN_STEPS.has(step?.name) ? step.name : 'step #' + (index + 1));
    lines.push('- ' + name + ' — ' + stepState(step));
    if (!Array.isArray(step?.attempts)) continue;
    for (const [i, item] of step.attempts.slice(0, 30).entries()) {
      const state = stepState(item);
      const note = item?.error ? summarizeError(item.error) : null;
      lines.push('  - Attempt ' + (i + 1) + ' — ' + state + (note ? ' (' + note.code + '; ' + note.cause + ')' : ''));
    }
  }
  return lines;
}

export async function diagnoseSmoke(api, id, report) {
  if (typeof id !== 'string' || !ID.test(id)) throw new Error('MIGRATION_SMOKE_INSTANCE_ID_INVALID');
  const instance = await api.get(INSTANCES + '/' + id);
  const invalidOutput = instance?.status === 'complete'
    && !['MIGRATION_SMOKE_OK', '"MIGRATION_SMOKE_OK"', 'MIGRATION_SMOKE_CLEANUP_OK', '"MIGRATION_SMOKE_CLEANUP_OK"']
      .includes(instance.output);
  await report(describeSmoke(id, instance, invalidOutput ? 'MIGRATION_SMOKE_OUTPUT_INVALID' : undefined));
}

export async function runSmoke(api, report, { id = randomUUID(), wait = sleep, maxPolls = 50, runId, emit = () => {}, runtime = {} } = {}) {
  const path = INSTANCES + '/' + id;
  // The pinned Wrangler sends an object here, matching WorkflowEvent.payload.
  for (let attempt = 0; ; attempt++) {
    try {
      emit('workflow', 'instance-create', 'WORKFLOW_INSTANCE_CREATE', 'STARTED', { attempt: attempt + 1, expected: 'queued' });
      await api.request(INSTANCES, { method: 'POST', body: { instance_id: id, params: { operation: 'smoke', ...(runId ? { runId } : {}) } } });
      emit('workflow', 'instance-create', 'WORKFLOW_INSTANCE_CREATE', 'OK', { attempt: attempt + 1, actual: 'queued' });
      break;
    } catch (error) {
      emit('workflow', 'instance-create', 'WORKFLOW_INSTANCE_CREATE', 'FAILED', { attempt: attempt + 1,
        error_code: 'WORKFLOW_INSTANCE_CREATE_FAILED', actual: 'creation-not-confirmed', details: { http_status: error?.status } });
      // An explicit rate-limit refusal can be retried with the same instance ID.
      if (error?.status === 429 && attempt < 2) {
        emit('workflow', 'instance-create', 'WORKFLOW_INSTANCE_CREATE_RETRY', 'RETRY', { attempt: attempt + 1, details: { delay_ms: 2000 * 2 ** attempt } });
        await wait(2000 * 2 ** attempt);
        continue;
      }
      if (error?.transient && error?.status !== 429) {
        // A lost POST response may have created the instance. Read back the same ID.
        break;
      }
      await report(describeSmoke(id, null, 'MIGRATION_SMOKE_CREATE_FAILED'));
      throw error;
    }
  }

  const deadline = Date.now() + 240000;
  let instance;
  try {
    for (let poll = 0; poll < maxPolls && Date.now() < deadline; poll++) {
      try {
        emit('workflow', 'instance-poll', 'WORKFLOW_POLL', 'STARTED', { attempt: poll + 1, expected: 'instance-status',
          details: { poll: poll + 1, remaining_ms: Math.max(0, deadline - Date.now()) } });
        instance = await api.get(path);
        runtime.instance = instance;
        emit('workflow', 'instance-poll', 'WORKFLOW_POLL', instance ? 'OK' : 'NOT_OBSERVED', {
          attempt: poll + 1, actual: safeStatus(instance?.status), details: { poll: poll + 1, remaining_ms: Math.max(0, deadline - Date.now()) },
        });
      } catch (error) {
        emit('workflow', 'instance-poll', 'WORKFLOW_POLL', 'FAILED', { attempt: poll + 1,
          error_code: 'WORKFLOW_POLL_FAILED', details: { http_status: error?.status } });
        if (error?.transient || (poll < 3 && error?.status === 404)) {
          await wait(5000);
          continue;
        }
        throw error;
      }
      const status = safeStatus(instance?.status);
      if (status === 'complete') {
        if (!['MIGRATION_SMOKE_OK', '"MIGRATION_SMOKE_OK"'].includes(instance.output)) {
          await report(describeSmoke(id, instance, 'MIGRATION_SMOKE_OUTPUT_INVALID'));
          throw new Error('MIGRATION_SMOKE_OUTPUT_INVALID ' + id);
        }
        await report([...describeSmoke(id, instance), 'MIGRATION_SMOKE_OK', ...PASSED.map(check => '- Passed: ' + check)]);
        return;
      }
      if (!ACTIVE.has(status)) {
        const lines = describeSmoke(id, instance, status === 'unknown' ? 'MIGRATION_SMOKE_STATUS_INVALID' : undefined);
        if (['errored', 'failed', 'terminated', 'canceled', 'cancelled'].includes(status)) {
          const cleanupId = randomUUID();
          try {
            await api.request(INSTANCES, { method: 'POST',
              body: { instance_id: cleanupId, params: { operation: 'cleanup', targetId: id, ...(runId ? { runId } : {}) } } });
            runtime.cleanupId = cleanupId;
            emit('cleanup', 'cleanup-dispatch', 'CLEANUP_INSTANCE_CREATE', 'OK', { actual: 'queued' });
            lines.push('Cleanup instance: ' + cleanupId);
          } catch {
            emit('cleanup', 'cleanup-dispatch', 'CLEANUP_INSTANCE_CREATE', 'FAILED', { error_code: 'CLEANUP_DISPATCH_FAILED', actual: 'unconfirmed' });
            lines.push('Cleanup could not be queued; a later smoke sweeps expired synthetic objects.');
          }
        }
        await report(lines);
        throw new Error('MIGRATION_SMOKE_' + status.toUpperCase() + ' ' + id);
      }
      await wait(5000);
    }
  } catch (error) {
    if (!error?.message?.startsWith('MIGRATION_SMOKE_')) {
      await report(describeSmoke(id, instance, 'MIGRATION_SMOKE_POLL_FAILED'));
    }
    throw error;
  }
  await report(describeSmoke(id, instance, 'MIGRATION_SMOKE_TIMEOUT'));
  throw new Error('MIGRATION_SMOKE_TIMEOUT ' + id);
}
