import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { sanitizeTrace, TRACE_ID, TRACE_PREFIX, traceStepName } from './trace.mjs';

export const STEPS = [
  'Sweep expired smoke objects', 'Upload signed R2 backup', 'Verify R2 HEAD', 'Observe R2 notification in D1',
  'Replay R2 event via Queue', 'Verify exact Queue replay receipt', 'Reject signed PUT mime', 'Reject signed PUT length',
  'Reject signed PUT conditional', 'Prime signed PUT expiry control', 'Wait for signed PUT expiration', 'Reject signed PUT expired', 'Verify fresh PUT after expiry', 'Reject conditional overwrite', 'Reject anonymous R2 GET',
  'Delete current smoke objects', 'Delete failed smoke objects',
];
const LOGS = '/workers/observability/telemetry/query';
const R2 = '/r2/buckets/mezfit-migration-uploads/objects';
const INSTANCES = '/workflows/mezfit-migration-workflow/instances';
const UUID_FILE = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.json$/i;
const knownStages = new Map(STEPS.map(name => [traceStepName(name), name]));
const legacyStages = new Map([
  ['check-signed-upload-and-bucket-privacy', 'check signed upload and bucket privacy'],
  ['observe-r2-event-in-d1', 'Observe R2 notification in D1'],
  ['replay-original-r2-event', 'Replay R2 event via Queue'],
  ['verify-idempotent-replay-in-d1', 'Verify exact Queue replay receipt'],
  ['delete-synthetic-backup', 'Delete current smoke objects'],
]);

export function workflowStepName(value) {
  if (typeof value !== 'string') return null;
  const slug = traceStepName(value).replace(/-(?:\d+|[a-f0-9]{8,64})$/, '');
  return knownStages.get(slug) ?? legacyStages.get(slug) ?? null;
}

function parseObject(value) {
  if (typeof value !== 'string') return value;
  if (value.length > 100000) return null;
  try { return JSON.parse(value); } catch { return null; }
}

export function workerRecords(data, id) {
  const events = data?.events?.events;
  if (!Array.isArray(events)) throw new Error('TRACE_LOGS_RESPONSE_INVALID');
  return {
    records: events.flatMap(item => {
      const source = parseObject(item?.source);
      const row = sanitizeTrace(source) ?? sanitizeTrace(parseObject(source?.message));
      return row?.trace_id === id ? [row] : [];
    }),
    truncated: Number.isSafeInteger(data.events.count) && data.events.count > events.length, cursor: events.at(-1)?.$metadata?.id,
  };
}

export function historyRecords(instance, id, context = {}) {
  const steps = Array.isArray(instance?.steps) ? instance.steps : [];
  const rows = [];
  for (const [index, row] of steps.entries()) {
    const name = workflowStepName(row?.name);
    const stage = name ? traceStepName(name) : 'workflow-step-' + (index + 1);
    const attempts = Array.isArray(row?.attempts) ? row.attempts
      : row?.type === 'sleep' ? [{ start: row.start, end: row.end, success: row.end ? true : undefined }] : [];
    for (const [offset, attempt] of attempts.entries()) {
      const start = Date.parse(attempt?.start);
      const end = Date.parse(attempt?.end);
      const reported = typeof attempt?.error?.message === 'string' ? attempt.error.message : '';
      const controlled = /\b(SMOKE_[A-Z0-9_]{1,75})\|[a-z]+\|([a-zA-Z0-9_-]{1,90})\|([a-zA-Z0-9_-]{1,90})\b/.exec(reported);
      const timedOut = attempt?.error?.name === 'TimeoutError' || /\btimed? ?out\b/i.test(reported);
      const fields = { ...context, trace_id: id, instance_id: context.instance_id ?? id, component: 'workflow', stage, event: 'WORKFLOW_HISTORY_ATTEMPT',
        attempt: offset + 1, worker_version: instance?.versionId ?? instance?.version_id, details: { source: 'workflow_history' } };
      if (Number.isFinite(start)) rows.push(sanitizeTrace({ ...fields, timestamp: new Date(start).toISOString(),
        status: 'STARTED', expected: 'step-completed' }));
      if (Number.isFinite(end)) rows.push(sanitizeTrace({ ...fields, timestamp: new Date(end).toISOString(),
        status: attempt.success === true ? 'OK' : attempt.success === false ? 'FAILED' : 'NOT_OBSERVED',
        error_code: attempt.success === false ? (controlled?.[1] ?? (timedOut ? 'WORKFLOW_STEP_TIMEOUT' : 'WORKFLOW_STEP_EXCEPTION')) : undefined,
        duration_ms: Number.isFinite(start) ? Math.max(0, end - start) : undefined,
        expected: controlled?.[2] ?? 'step-completed', actual: controlled?.[3] ?? (timedOut ? 'timeout' : attempt.success === true ? 'step-completed' : 'step-result-unavailable') }));
    }
  }
  return rows.filter(Boolean);
}

async function collectWorkers(api, id, since) {
  let offset;
  const records = [];
  for (let page = 0; page < 3; page++) {
    const data = (await api.request(LOGS, { method: 'POST', body: {
      queryId: randomUUID(), timeframe: { from: since, to: Date.now() }, dry: true, limit: 250,
      parameters: { view: 'events', needle: { value: id, isRegex: false },
        filters: [{ key: '$metadata.service', operation: 'eq', type: 'string', value: 'mezfit-migration' }] },
      ...(offset ? { offset } : {}),
    } })).result;
    const parsed = workerRecords(data, id);
    records.push(...parsed.records);
    if (!parsed.truncated) return { records, truncated: false };
    if (!parsed.cursor || parsed.cursor === offset) break;
    offset = parsed.cursor;
  }
  return { records, truncated: true };
}

async function collectR2(api, id) {
  const prefix = TRACE_PREFIX + id + '/';
  const records = [];
  let cursor;
  let unavailable = false;
  for (let page = 0; page < 3; page++) {
    const query = new URLSearchParams({ prefix, per_page: '100', ...(cursor ? { cursor } : {}) });
    const response = await api.request(R2 + '?' + query);
    if (!Array.isArray(response.result)) throw new Error('TRACE_R2_LIST_INVALID');
    const keys = response.result.map(item => item?.key).filter(key => typeof key === 'string' && key.startsWith(prefix)
      && UUID_FILE.test(key.slice(prefix.length)));
    for (let start = 0; start < keys.length; start += 12) {
      const batch = await Promise.allSettled(keys.slice(start, start + 12).map(key => api.request(
        R2 + '/' + encodeURIComponent(key), { raw: true })));
      for (const item of batch) {
        if (item.status === 'rejected') { unavailable = true; continue; }
        const list = parseObject(item.value);
        if (!Array.isArray(list)) { unavailable = true; continue; }
        records.push(...list.map(sanitizeTrace).filter(record => record?.trace_id === id));
      }
    }
    if (!response.result_info?.is_truncated) return { records, truncated: unavailable };
    const next = response.result_info.cursor;
    if (!next || next === cursor) break;
    cursor = next;
  }
  return { records, truncated: true };
}

export async function collectRuntimeTrace(api, storage, id, since, emit, { wait = sleep, polls = 4 } = {}) {
  const records = new Map();
  const coverage = {};
  if (!TRACE_ID.test(id ?? '')) throw new Error('TRACE_INSTANCE_ID_INVALID');
  for (let poll = 1; poll <= polls; poll++) {
    const sources = [['workers_logs', () => collectWorkers(api, id, since)], ['r2_trace', () => collectR2(storage, id)]];
    await Promise.all(sources.map(async ([source, collect]) => {
      if (coverage[source] === 'permission-denied') return;
      emit('github', 'trace-collection', 'RUNTIME_TRACE_READ', 'STARTED', { attempt: poll, expected: 'trace-records', details: { source } });
      try {
        const result = await collect();
        for (const row of result.records) records.set(JSON.stringify(row), row);
        coverage[source] = result.truncated ? 'partial' : result.records.length ? 'received' : 'empty';
        emit('github', 'trace-collection', 'RUNTIME_TRACE_READ', result.records.length ? 'OK' : 'NOT_OBSERVED', {
          attempt: poll, actual: coverage[source], details: { source, count: result.records.length, truncated: result.truncated },
        });
      } catch (error) {
        coverage[source] = [401, 403].includes(error?.status) ? 'permission-denied' : 'unavailable';
        emit('github', 'trace-collection', 'RUNTIME_TRACE_READ', 'NOT_OBSERVED', {
          attempt: poll, actual: coverage[source], error_code: 'TRACE_SOURCE_UNAVAILABLE', details: { source, http_status: error?.status },
        });
      }
    }));
    if (poll < polls && Object.values(coverage).some(status => status !== 'permission-denied')) {
      emit('github', 'trace-collection', 'RUNTIME_TRACE_READ', 'RETRY', { attempt: poll, actual: 'waiting-for-ingestion', details: { delay_ms: 4000 } });
      await wait(4000);
    }
  }
  return { records: [...records.values()], coverage };
}

export async function observeInstance(api, id, emit, { wait = sleep, polls = 1 } = {}) {
  let instance;
  if (!TRACE_ID.test(id ?? '')) return instance;
  for (let attempt = 1; attempt <= polls; attempt++) {
    try {
      instance = await api.get(INSTANCES + '/' + id);
      const status = ['complete', 'errored', 'terminated', 'failed', 'paused', 'canceled', 'cancelled'].includes(instance?.status)
        ? 'terminal' : instance ? 'active' : 'unavailable';
      emit('workflow', 'instance-history', 'WORKFLOW_HISTORY_READ', instance ? 'OK' : 'NOT_OBSERVED', {
        attempt, actual: status, details: { source: 'workflow_history', count: Array.isArray(instance?.steps) ? instance.steps.length : 0 },
      });
      if (status === 'terminal') break;
    } catch (error) {
      emit('workflow', 'instance-history', 'WORKFLOW_HISTORY_READ', 'NOT_OBSERVED', {
        attempt, error_code: 'WORKFLOW_HISTORY_UNAVAILABLE', details: { source: 'workflow_history', http_status: error?.status },
      });
      if ([401, 403].includes(error?.status)) break;
    }
    if (attempt < polls) await wait(3000);
  }
  return instance;
}

export function summarizeTrace(records, activeSmoke, evidence) {
  const rows = [];
  if (activeSmoke) {
    for (const [stage, event] of [
      ['r2-notification-rule', 'R2_NOTIFICATION_MATCH'], ['signed-upload', 'R2_PUT_COMMITTED'],
      ['r2-notification-published', 'R2_NOTIFICATION_PUBLISHED'], ['queue-invocation', 'QUEUE_CONSUMER_INVOKED'], ['queue-message', 'QUEUE_MESSAGE_RECEIVED'],
      ['event-validation', 'QUEUE_EVENT_VALIDATED'], ['consumer-head', 'CONSUMER_R2_HEAD'],
      ['job-insert', 'D1_JOB_INSERT'], ['job-read', 'D1_JOB_SELECT'], ['replay-send', 'QUEUE_REPLAY_SEND'],
    ]) {
      const matches = records.filter(row => (row.event === event
        || event === 'QUEUE_EVENT_VALIDATED' && row.event === 'QUEUE_EVENT_REJECTED'
        || event === 'R2_PUT_COMMITTED' && row.event === 'R2_PUT_RECONCILED') && !['STARTED', 'RETRY'].includes(row.status));
      rows.push({ stage, status: matches.at(-1)?.status ?? 'NOT_OBSERVED' });
    }
    const workflowFailed = records.some(row => row.component === 'workflow'
      && row.event === 'WORKFLOW_HISTORY_ATTEMPT' && row.status === 'FAILED');
    for (const name of STEPS) {
      const stage = traceStepName(name);
      const matches = records.filter(row => row.stage === stage && ['WORKFLOW_STEP', 'WORKFLOW_HISTORY_ATTEMPT'].includes(row.event));
      const terminal = matches.filter(row => row.status === 'OK' || row.status === 'FAILED');
      rows.push({ stage, status: terminal.at(-1)?.status ?? (matches.length || !evidence.workflow || !workflowFailed
        ? 'NOT_OBSERVED' : 'NOT_REACHED') });
    }
  }
  // A missing D1 poll is a symptom, not evidence that R2 or Queue dropped the event.
  const failures = records.filter((row, index) => row.status === 'FAILED'
    && !['SMOKE_D1_EVENT_PENDING', 'SMOKE_QUEUE_REPLAY_PENDING'].includes(row.error_code)
    && !records.slice(index + 1).some(later => later.status === 'OK' && later.stage === row.stage
      && later.event === row.event && (row.details.field == null || later.details.field === row.details.field)));
  const failure = failures.find(row => row.component === 'consumer' || row.component === 'd1' || row.component === 'r2')
    ?? failures.find(row => row.component !== 'cloudflare-api' && row.stage !== 'trace-collection');
  const last = records.findLast(row => row.status === 'OK' && ['r2', 'consumer', 'd1', 'queue', 'workflow'].includes(row.component)
    && !['trace-persist', 'trace-collection', 'instance-history', 'delete-current-smoke-objects', 'delete-failed-smoke-objects'].includes(row.stage)
    && row.actual !== 'row-missing' && row.actual !== 'object-missing');
  return { stages: rows, first_confirmed_failure: failure ?? null, last_confirmed_success: last ?? null };
}
