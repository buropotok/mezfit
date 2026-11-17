import { writeFile as writeTraceFile } from 'node:fs/promises';
import { TRACE_ID, classifyTraceError, sanitizeTrace, traceWriter } from './trace.mjs';
import { collectRuntimeTrace, historyRecords, observeInstance, summarizeTrace } from './trace-collector.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { PROCESSOR_VERSION, processorInstanceId } from './processor-protocol.mjs';
import { deployedWorkerVersion, runProcessorSmoke } from './processor-control.mjs';
import { diagnoseSmoke, runSmoke } from './smoke-control.mjs';

const BUCKET = 'mezfit-migration-uploads';
const QUEUE = 'mezfit-migration-events';
const DATABASE = 'mezfit-migration-jobs';
const WORKER = 'mezfit-migration';
const WORKFLOW = 'mezfit-migration-workflow';
const TOKEN = 'mezfit-migration-uploads-uploader';
const OWNER = 'mezfit-migration-v1';
const SECRET_NAMES = ['MIGRATION_R2_ACCESS_KEY_ID', 'MIGRATION_R2_SECRET_ACCESS_KEY'];
const R2_WRITE = 'Workers R2 Storage Bucket Item Write';
const R2_SCOPE = 'com.cloudflare.edge.r2.bucket';
const UUID = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const ID = /^[a-f0-9]{32}$/;
// The REST API expects milliseconds for the batch timeout and seconds for the retry delay.
const CONSUMER_SETTINGS = { batch_size: 10, max_wait_time_ms: 5 * 1000, max_retries: 5, retry_delay: 10 };
const CONSUMER_DEFAULTS = { batch_size: 10, max_wait_time_ms: 5000, max_retries: 3 };
const WORKER_PATH = '/workers/scripts/' + WORKER;
const BUCKET_PATH = '/r2/buckets/' + BUCKET;
const NOTIFICATIONS = '/event_notifications/r2/' + BUCKET + '/configuration';
const RULE = {
  actions: ['PutObject', 'CopyObject', 'CompleteMultipartUpload'],
  description: 'Register migration backup uploads',
};

const TRACE_ARTIFACT = 'migration-trace.json';
let runnerTrace = () => {};
let workerVersion;

function endpointName(path) {
  const route = path.split('?')[0];
  if (route === '') return 'account';
  if (route.startsWith('/event_notifications/')) return route.includes('/queues/') ? 'r2-notification-rule' : 'r2-notifications';
  if (route.startsWith('/r2/')) {
    if (route.includes('/objects/')) return 'r2-object';
    if (route.endsWith('/objects')) return 'r2-objects';
    if (route.endsWith('/cors')) return 'r2-cors';
    if (route.endsWith('/managed')) return 'r2-domains-managed';
    if (route.endsWith('/custom')) return 'r2-domains-custom';
    return route === '/r2/buckets' ? 'r2-buckets' : 'r2-bucket';
  }
  if (route === '/queues') return 'queues';
  if (route.startsWith('/queues/')) return route.endsWith('/metrics') ? 'queue-metrics' : 'queue-details';
  if (route.startsWith('/d1/')) return route.endsWith('/query') ? 'd1-query' : 'd1-databases';
  if (route.startsWith('/tokens')) return route.endsWith('/permission_groups') ? 'token-permission-groups'
    : route === '/tokens' ? 'token-list' : 'token-details';
  if (route.startsWith('/workers/observability/')) return 'workers-telemetry';
  if (route.startsWith('/workers/scripts/')) return route.endsWith('/deployments') ? 'worker-deployments'
    : route.endsWith('/settings') ? 'worker-settings'
    : route.endsWith('/secrets') ? 'worker-secrets' : 'worker-subdomain';
  if (route.startsWith('/workflows/')) return route.endsWith('/instances') ? 'workflow-instances'
    : route.includes('/instances/') ? 'workflow-instance' : 'workflow';
  return 'other';
}

function checkTrace(component, stage, event, state, expected, actual, details = {}) {
  runnerTrace(component, stage, event, state, { expected, actual, details });
}

function safeStatusFailure(error, fallback) {
  // Never include an arbitrary upstream message in the trace.
  return /^(?:CLOUDFLARE|MIGRATION|R2|WORKFLOW|WRANGLER|D1|QUEUE|DEPLOYED|PROCESSOR)_[A-Z0-9_]{1,80}\b/.exec(error?.message ?? '')?.[0] ?? fallback;
}

async function capture(emit, component, stage, event, action, summarize) {
  const start = Date.now();
  emit(component, stage, event, 'STARTED', { expected: 'readback' });
  try {
    const value = await action();
    emit(component, stage, event, 'OK', { duration_ms: Date.now() - start, ...summarize(value) });
    return value;
  } catch (error) {
    emit(component, stage, event, 'NOT_OBSERVED', { expected: 'readback', actual: 'unavailable',
      error_code: event + '_UNAVAILABLE', duration_ms: Date.now() - start, details: { http_status: error?.status } });
  }
}

async function finalTrace({ id, operation, runtime, records, deploy, infra, state, emit, failure, since }) {
  const processor = operation === 'processor-smoke';
  const activeSmoke = runtime.started || operation === 'diagnose';
  const history = [];
  let coverage = {};
  const pending = [];
  if (processor && runtime.readinessId && deploy) {
    pending.push((async () => {
      const instance = await observeInstance(deploy, runtime.readinessId, emit);
      if (instance) history.push(...historyRecords(instance, id, { instance_id: runtime.readinessId,
        job_id: id, processor_version: PROCESSOR_VERSION }));
    })());
  }
  if (activeSmoke && deploy) {
    pending.push((async () => {
      const instance = runtime.instance ?? await observeInstance(deploy, id, emit);
      if (instance) {
        coverage.workflow_history = 'received';
        history.push(...historyRecords(instance, id));
      } else coverage.workflow_history = 'unavailable';
      if (processor) {
        const instanceId = processorInstanceId(id);
        const process = await observeInstance(deploy, instanceId, emit);
        coverage.processor_history = process ? 'received' : 'unavailable';
        if (process) history.push(...historyRecords(process, id, { instance_id: instanceId,
          job_id: id, processor_version: PROCESSOR_VERSION }));
      }
      if (runtime.cleanupId) {
        const cleanup = await observeInstance(deploy, runtime.cleanupId, emit, { polls: 5 });
        coverage.cleanup = cleanup?.status === 'complete' ? 'completed' : 'unconfirmed';
        if (cleanup) history.push(...historyRecords(cleanup, id, { instance_id: runtime.cleanupId }));
        emit('cleanup', 'failed-smoke-cleanup', 'CLEANUP_READBACK', coverage.cleanup === 'completed' ? 'OK' : 'NOT_OBSERVED',
          { expected: 'completed', actual: coverage.cleanup });
      }
      let from = since - 90000;
      if (operation === 'diagnose' && instance) {
        const queued = Date.parse(instance.queued ?? instance.start);
        if (Number.isFinite(queued)) from = queued - 30000;
      }
      const result = await collectRuntimeTrace(deploy, infra ?? deploy, id, from, emit);
      history.push(...result.records);
      Object.assign(coverage, result.coverage);
    })());
  }
  if (state?.queue?.queue_id && (runtime.started || failure)) {
    pending.push(capture(emit, 'queue', 'queue-metrics', 'QUEUE_BACKLOG_SNAPSHOT',
      () => infra.get('/queues/' + state.queue.queue_id + '/metrics'),
      value => ({ actual: 'aggregate-only', details: { source: 'queue_metrics', backlog_count: value?.backlog_count,
        backlog_bytes: value?.backlog_bytes, oldest_message_timestamp_ms: value?.oldest_message_timestamp_ms } })));
  }
  if (state?.bucket?.bucket && (runtime.started || failure)) {
    pending.push(capture(emit, 'r2', 'r2-notification-rule', 'R2_NOTIFICATION_SNAPSHOT',
      () => inspectBucket(infra, state.queue, state.origin),
      value => ({ actual: value.notifications, details: { source: 'configuration', matched: value.notifications === 'current' } })));
  }
  if (state?.database?.uuid && runtime.started && deploy) {
    for (const [table, clause, param] of [
      ['migration_jobs', 'object_key', (processor ? 'uploads/' : 'smoke/') + id],
      ['migration_smoke_replays', 'replay_id', id],
      ...(processor ? [['migration_executions', 'job_id', 'uploads/' + id]] : []),
    ]) {
      pending.push(capture(emit, 'd1', 'd1-final-read', 'D1_REST_SELECT',
        async () => {
          const response = await deploy.request('/d1/database/' + state.database.uuid + '/query', {
            method: 'POST', body: { sql: 'SELECT COUNT(*) AS count FROM ' + table + ' WHERE ' + clause + ' = ?', params: [param] },
          });
          const count = response.result?.[0]?.results?.[0]?.count;
          if (!Number.isSafeInteger(count) || response.result[0]?.success !== true) throw new Error('D1_TRACE_QUERY_INVALID');
          return count;
        }, count => ({ actual: count ? 'row-found' : 'row-missing', details: { table, sql: 'SELECT', count, exists: count > 0 } })));
    }
  }
  await Promise.allSettled(pending);
  if (activeSmoke) {
    emit('r2', 'r2-notification-published', 'R2_NOTIFICATION_PUBLISHED', 'NOT_OBSERVED', {
      expected: 'per-object-publisher-receipt', actual: 'no-provider-receipt', details: { source: 'configuration' },
    });
  }
  const all = [...records, ...history].map(row => sanitizeTrace({ ...row, run_id: row.run_id ?? process.env.GITHUB_RUN_ID }))
    .filter(Boolean).sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  if (processor) {
    coverage.invocation_cpu = all.some(row => row.event === 'WORKERS_INVOCATION_CPU') ? 'received' : 'unavailable';
  }
  const report = summarizeTrace(all, activeSmoke, { workflow: coverage.workflow_history === 'received' }, processor);
  const smokeResult = failure ? 'FAILED' : runtime.started ? 'OK' : operation === 'diagnose' ? 'HISTORY_ONLY' : 'SKIPPED';
  const missing = Object.entries(coverage).filter(([, value]) => !['received', 'completed'].includes(value));
  if (activeSmoke) missing.push(['r2-per-object-publisher-receipt', 'unavailable']);
  const output = [
    processor ? '## MIGRATION PROCESSING TRACE' : '## MIGRATION TRACE', 'Trace ID: ' + id,
    ...(processor ? ['Job ID: ' + id, 'Processor version: ' + PROCESSOR_VERSION] : []),
    'Commit: ' + (process.env.GITHUB_SHA ?? 'unavailable'),
    'Worker version: ' + (workerVersion ?? all.findLast(row => row.worker_version)?.worker_version ?? 'unavailable'),
    'Smoke result: ' + smokeResult, 'Collection: ' + (missing.length ? 'PARTIAL' : 'observed sources collected'),
    ...missing.map(([source, value]) => '- ' + source + ': ' + value),
    'First confirmed failure: ' + (report.first_confirmed_failure?.stage ?? 'unestablished'),
    'Last confirmed success: ' + (report.last_confirmed_success?.stage ?? 'unobserved'),
    ...(report.first_confirmed_failure ? ['Confirmed failure code: ' + report.first_confirmed_failure.error_code] : []),
    ...(activeSmoke && !report.first_confirmed_failure && failure
      ? ['Cause unestablished. Use Worker and Workflow trace sources above; aggregate backlog cannot prove delivery of this object.'] : []),
    '', '| Stage | Status |', '|---|---|', ...report.stages.map(row => '| ' + row.stage + ' | ' + row.status + ' |'),
  ];
  await writeTraceFile(TRACE_ARTIFACT, JSON.stringify({ trace_id: id, smoke_result: smokeResult,
    coverage, missing, summary: report, events: all }, null, 2) + '\n', { mode: 0o600 });
  console.log(output.join('\n'));
  for (const row of all) console.log(JSON.stringify(row));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, output.join('\n') + '\n');
}

function requireState(condition, code) {
  if (!condition) throw new Error(code);
}

function cloudflarePermission(path, method) {
  const access = method === 'GET' ? 'Read or Edit' : 'Edit';
  if (path.startsWith('/tokens')) return 'Account API Tokens: ' + access;
  if (path.startsWith('/d1/')) return 'D1: ' + access;
  if (path.startsWith('/r2/') || path.startsWith('/event_notifications/')) return 'Workers R2 Storage: ' + access;
  if (path.startsWith('/queues')) return method === 'GET' ? 'Queues: Read or Edit (or Workers Scripts)' : 'Queues: Edit';
  if (path.startsWith('/workers/') || path.startsWith('/workflows/')) return 'Workers Scripts: ' + access;
  return 'access to this account API';
}

export class CloudflareApi {
  constructor(account, token, label) {
    requireState(ID.test(account), 'CLOUDFLARE_ACCOUNT_ID_INVALID');
    requireState(token, label + '_SECRET_REQUIRED');
    this.base = 'https://api.cloudflare.com/client/v4/accounts/' + account;
    this.token = token;
    this.label = label;
  }

  async request(path, { method = 'GET', body, optional = false, raw = false } = {}) {
    const operation = this.label + ' ' + method + ' ' + path.split('?')[0];
    const retryable = status => status == null || status === 429 || status >= 500;
    let response;
    const endpoint = endpointName(path);
    const stage = 'api-' + endpoint;
    // A mutation may have committed before a lost response.
    for (let attempt = 0; ; attempt++) {
      const start = Date.now();
      let error;
      runnerTrace('cloudflare-api', stage, 'CLOUDFLARE_REQUEST', 'STARTED', {
        attempt: attempt + 1, expected: 'cloudflare-response', details: { endpoint, method, timeout_ms: 10000 },
      });
      response = await fetch(this.base + path, {
        method, redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { Authorization: 'Bearer ' + this.token,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }).catch(caught => { error = caught; return null; });
      const canRetry = method === 'GET' && retryable(response?.status) && attempt < 2;
      const cfCodes = response && !response.ok && !raw ? await response.clone().json()
        .then(value => Array.isArray(value?.errors) ? value.errors.map(item => item?.code) : [], () => []) : [];
      runnerTrace('cloudflare-api', stage, 'CLOUDFLARE_REQUEST', response?.ok ? 'OK'
        : optional && response?.status === 404 ? 'NOT_OBSERVED' : 'FAILED', {
        attempt: attempt + 1, duration_ms: Date.now() - start, expected: 'cloudflare-response',
        actual: response ? 'http-' + response.status : 'transport-error',
        error_code: response?.ok || optional && response?.status === 404 ? undefined : 'CLOUDFLARE_REQUEST_FAILED',
        details: { endpoint, method, http_status: response?.status, cf_codes: cfCodes, can_retry: canRetry,
          classification: error ? classifyTraceError(error) : undefined },
      });
      if (!canRetry) break;
      const retryAfter = response?.headers.get('Retry-After');
      const seconds = Number(retryAfter);
      const hinted = retryAfter && !Number.isFinite(seconds) ? Date.parse(retryAfter) - Date.now() : seconds * 1000;
      const delayMs = Math.min(5000, Math.max(500 * 2 ** attempt, Number.isFinite(hinted) ? hinted : 0));
      runnerTrace('cloudflare-api', stage, 'CLOUDFLARE_REQUEST_RETRY', 'RETRY', {
        attempt: attempt + 1, actual: 'transient-response', details: { endpoint, method, delay_ms: delayMs },
      });
      await response?.body?.cancel().catch(() => {});
      await delay(delayMs);
    }
    if (!response) throw Object.assign(new Error(operation + ' request failed'), { transient: true });
    if (optional && response.status === 404) return null;
    if (raw && response.ok) {
      const reader = response.body?.getReader();
      if (!reader) throw new Error('MIGRATION_TRACE_R2_BODY_MISSING');
      let remaining = 100000;
      let value = '';
      const decoder = new TextDecoder();
      try {
        while (remaining > 0) {
          const chunk = await reader.read();
          if (chunk.done) return value + decoder.decode();
          remaining -= chunk.value.length;
          if (remaining < 0) break;
          value += decoder.decode(chunk.value, { stream: true });
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      throw new Error('MIGRATION_TRACE_R2_BODY_LIMIT');
    }
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.success !== true || !Object.hasOwn(data, 'result')) {
      const codes = Array.isArray(data?.errors) ? data.errors.map(error => error?.code).filter(Number.isInteger) : [];
      // R2 returns this error before the bucket has any notification rules.
      if (method === 'GET' && path === NOTIFICATIONS && response.status === 404
        && data?.success === false && data.errors?.length === 1 && codes[0] === 11015) {
        checkTrace('r2', 'r2-notifications', 'R2_NOTIFICATION_CONFIGURATION_ABSENT', 'NOT_OBSERVED', 'configured-rule', 'rule-missing');
        return { success: true, result: { bucketName: BUCKET, queues: [] } };
      }
      const access = [401, 403].includes(response.status) || codes.includes(10000) || codes.includes(9109)
        ? ' (verify ' + cloudflarePermission(path, method) + ')' : '';
      throw Object.assign(new Error(operation + ' failed with HTTP ' + response.status + ' (Cloudflare codes: '
        + (codes.join(', ') || 'none') + ')' + access), {
        status: response.status, transient: retryable(response.status) && !access,
      });
    }
    return data;
  }

  async get(path, optional = false) {
    return (await this.request(path, { optional }))?.result ?? null;
  }

  async pages(path) {
    const results = [];
    const size = 50;
    for (let page = 1; page <= 100; page++) {
      const response = await this.request(path + '?per_page=' + size + '&page=' + page);
      requireState(Array.isArray(response.result), 'INVALID_LIST_RESPONSE ' + path);
      results.push(...response.result);
      const { total_pages, total_count } = response.result_info ?? {};
      if (Number.isInteger(total_pages) ? page >= total_pages
        : Number.isInteger(total_count) ? results.length >= total_count
          : response.result.length < size) return results;
    }
    throw new Error('PAGINATION_LIMIT ' + path);
  }
}

function unique(entries, field, name) {
  const matches = entries.filter(entry => entry[field] === name);
  requireState(matches.length < 2, 'DUPLICATE_RESOURCE ' + name);
  return matches[0] ?? null;
}

function appOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('MEZFIT_APP_ORIGIN_INVALID');
  }
  requireState(url.protocol === 'https:' && (value === url.origin || value === url.origin + '/'),
    'MEZFIT_APP_ORIGIN_MUST_BE_EXACT_HTTPS_ORIGIN');
  return url.origin;
}

function desiredCors(origin) {
  return { rules: [{
    id: 'mezfit-migration-direct-upload',
    allowed: { origins: [origin], methods: ['PUT'], headers: ['Content-Type', 'If-None-Match'] },
    maxAgeSeconds: 3600,
  }] };
}

function sorted(values) { return Array.isArray(values) ? [...values].sort().join(',') : ''; }

function matchesCors(rules, origin) {
  const [rule] = rules;
  return rules.length === 1 && rule.id === 'mezfit-migration-direct-upload'
    && sorted(rule.allowed?.origins) === origin && sorted(rule.allowed?.methods) === 'PUT'
    && sorted(rule.allowed?.headers?.map(value => value.toLowerCase())) === 'content-type,if-none-match'
    && !rule.exposeHeaders?.length && rule.maxAgeSeconds === 3600;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function notificationQueueLinks(config) {
  if (config?.bucketName === BUCKET && (config.queues === undefined || Array.isArray(config.queues))) {
    return config.queues ?? [];
  }

  // Wrangler also reads the older bucket -> configuration ID -> { queue, rules } response.
  if (isRecord(config) && Object.keys(config).length === 1
    && Object.hasOwn(config, BUCKET) && isRecord(config[BUCKET])) {
    const links = Object.values(config[BUCKET]);
    if (links.length) return links.map(link => isRecord(link) ? { queueId: link.queue, rules: link.rules } : link);
  }

  throw new Error('MIGRATION_BUCKET_SETTINGS_RESPONSE_INVALID: R2 notification response');
}

function notificationQueueId(value) {
  if (typeof value !== 'string') return null;
  const id = value.toLowerCase();
  return ID.test(id) || UUID.test(id) ? id.replaceAll('-', '') : null;
}

function notificationDifferences(links, queue) {
  if (links.length !== 1) return ['queues.length (expected 1, got ' + links.length + ')'];
  const [target] = links;
  if (!isRecord(target)) return ['queues[0] (expected an object)'];

  // Keep diagnostics to field names and counts. API-provided strings may contain arbitrary text.
  const differences = [];
  const id = notificationQueueId(target.queueId);
  if (!id || id !== queue?.queue_id) differences.push('queueId (expected the migration queue ID)');
  if (target.queueName !== undefined && target.queueName !== QUEUE) {
    differences.push('queueName (expected the migration queue name)');
  }
  if (!Array.isArray(target.rules)) return [...differences, 'rules (expected an array)'];
  if (target.rules.length !== 1) {
    return [...differences, 'rules.length (expected 1, got ' + target.rules.length + ')'];
  }
  const [rule] = target.rules;
  if (!isRecord(rule)) return [...differences, 'rules[0] (expected an object)'];
  if (!Array.isArray(rule.actions) || rule.actions.length !== RULE.actions.length
    || !RULE.actions.every(action => rule.actions.includes(action))) {
    differences.push('actions (expected PutObject, CopyObject and CompleteMultipartUpload once each)');
  }
  if ((rule.prefix ?? '') !== '') differences.push('prefix (expected no filter)');
  if ((rule.suffix ?? '') !== '') differences.push('suffix (expected no filter)');
  return differences;
}

export async function inspectBucket(api, queue, origin) {
  const bucket = await api.get(BUCKET_PATH, true);
  if (!bucket) return { bucket: false, cors: 'missing', notifications: 'missing', private: true };
  requireState(bucket.name === BUCKET && (!bucket.jurisdiction || bucket.jurisdiction === 'default'),
    'MIGRATION_BUCKET_SCOPE_CONFLICT');
  const [managed, custom, cors, notifications] = await Promise.all([
    api.get(BUCKET_PATH + '/domains/managed'),
    api.get(BUCKET_PATH + '/domains/custom'),
    api.get(BUCKET_PATH + '/cors', true),
    api.get(NOTIFICATIONS),
  ]);
  requireState(typeof managed?.enabled === 'boolean' && Array.isArray(custom?.domains)
    && (!cors || Array.isArray(cors.rules)),
  'MIGRATION_BUCKET_SETTINGS_RESPONSE_INVALID');
  const rules = cors?.rules ?? [];
  const links = notificationQueueLinks(notifications);
  const differences = links.length ? notificationDifferences(links, queue) : [];
  const rulesFound = links.flatMap(link => Array.isArray(link?.rules) ? link.rules : []);
  checkTrace('r2', 'r2-notification-rule', 'R2_NOTIFICATION_MATCH', differences.length ? 'FAILED' : links.length ? 'OK' : 'NOT_OBSERVED',
    'unfiltered-object-create-rule', differences.length ? 'configuration-conflict' : links.length ? 'matches-smoke-key' : 'rule-missing',
    { bucket: BUCKET, queue: QUEUE, rule_count: rulesFound.length,
      prefix_filter: rulesFound.some(rule => !!rule?.prefix), suffix_filter: rulesFound.some(rule => !!rule?.suffix) });
  for (const action of RULE.actions) checkTrace('r2', 'r2-notification-action', 'R2_NOTIFICATION_ACTION',
    rulesFound.some(rule => Array.isArray(rule?.actions) && rule.actions.includes(action)) ? 'OK' : 'NOT_OBSERVED',
    'subscribed-action', 'configuration-only', { action });
  checkTrace('r2', 'r2-privacy', 'R2_PRIVACY_CHECK', !managed.enabled && !custom.domains.length ? 'OK' : 'FAILED',
    'private-bucket', !managed.enabled && !custom.domains.length ? 'private-bucket' : 'public-exposure',
    { private: !managed.enabled && !custom.domains.length });
  checkTrace('r2', 'r2-cors', 'R2_CORS_CHECK', !rules.length ? 'NOT_OBSERVED' : matchesCors(rules, origin) ? 'OK' : 'FAILED',
    'matching-cors', !rules.length ? 'cors-missing' : matchesCors(rules, origin) ? 'matches' : 'configuration-conflict');
  return {
    bucket: true,
    cors: !rules.length ? 'missing' : matchesCors(rules, origin) ? 'current' : 'conflict',
    notifications: !links.length ? 'missing' : differences.length ? 'conflict' : 'current',
    ...(differences.length ? { notificationConflict: 'R2_EVENT_NOTIFICATIONS_CONFLICT: ' + differences.join(', ') } : {}),
    private: !managed.enabled && !custom.domains.length,
  };
}

async function inspectWorker(api) {
  const settings = await api.get(WORKER_PATH + '/settings', true);
  if (!settings) return { exists: false, owned: true, private: true, secrets: [] };
  const [secrets, subdomain] = await Promise.all([
    api.get(WORKER_PATH + '/secrets'), api.get(WORKER_PATH + '/subdomain'),
  ]);
  requireState(Array.isArray(settings.bindings) && Array.isArray(secrets)
    && typeof subdomain?.enabled === 'boolean' && typeof subdomain?.previews_enabled === 'boolean',
  'MIGRATION_WORKER_SETTINGS_RESPONSE_INVALID');
  const observability = settings.observability;
  const logs = observability?.logs;
  const observed = observability?.enabled === true && logs?.enabled === true
    && logs.invocation_logs === true && logs.head_sampling_rate === 1;
  checkTrace('cloudflare-api', 'worker-observability', 'WORKERS_LOGS_READBACK', observed ? 'OK' : 'FAILED',
    'logs-and-invocations-at-full-sampling', observed ? 'verified' : 'observability-not-verified',
    { enabled: observability?.enabled, logs_enabled: logs?.enabled, invocation_logs: logs?.invocation_logs, sampling: logs?.head_sampling_rate });
  for (const name of SECRET_NAMES) {
    const present = secrets.some(secret => secret.type === 'secret_text' && secret.name === name);
    checkTrace('cloudflare-api', 'worker-secrets', 'WORKER_SECRET_PRESENCE', present ? 'OK' : 'NOT_OBSERVED',
      'secret-present', present ? 'present' : 'missing', { present, binding: name });
  }
  for (const [name, type] of [['UPLOADS', 'r2_bucket'], ['EVENTS', 'queue'], ['JOBS', 'd1'], ['MIGRATION_WORKFLOW', 'workflow'], ['MIGRATION_VERSION', 'version_metadata']]) {
    const present = settings.bindings.some(binding => binding.name === name && binding.type === type);
    checkTrace('cloudflare-api', 'worker-bindings', 'WORKER_BINDING_READBACK', present ? 'OK' : 'NOT_OBSERVED',
      'binding-present', present ? 'present' : 'missing', { present, binding: name });
  }
  return {
    exists: true,
    observability: observed,
    owned: settings.bindings.some(binding => binding.name === 'MIGRATION_INFRA_OWNER'
      && binding.type === 'plain_text' && binding.text === OWNER),
    private: !subdomain.enabled && !subdomain.previews_enabled,
    secrets: secrets.filter(secret => secret.type === 'secret_text').map(secret => secret.name),
  };
}

async function inspectQueue(api) {
  const queue = unique(await api.pages('/queues'), 'queue_name', QUEUE);
  if (!queue) return null;
  requireState(ID.test(queue.queue_id), 'MIGRATION_QUEUE_ID_INVALID');
  const details = await api.get('/queues/' + queue.queue_id);
  requireState(details?.queue_name === QUEUE && details.queue_id === queue.queue_id, 'MIGRATION_QUEUE_READBACK_INVALID');
  return details;
}

function queueWorkerDifferences(binding, path) {
  // The REST schema uses script_name for a consumer. Wrangler's Queue
  // readback also supports script and service + environment references.
  const names = [binding.script_name, binding.script, binding.service].filter(name => name != null);
  const differences = [];
  if (!names.length || names.some(name => name !== WORKER)) {
    differences.push(path + '.script_name/script/service (expected the migration Worker)');
  }
  const environment = binding.environment;
  if ((binding.service != null || environment != null) && environment !== 'production') {
    differences.push(path + '.environment (expected production)');
  }
  if ((binding.namespace ?? '') !== '') differences.push(path + '.namespace (expected no namespace)');
  return differences;
}

function queueSettingDifference(path, expected, actual) {
  const value = actual == null ? 'unset' : Number.isSafeInteger(actual) ? String(actual) : 'invalid value';
  return path + ' (expected ' + expected + ', got ' + value + ')';
}

export function queueConfigurationDifferences(queue, requireConsumer = false) {
  if (!queue) return [];
  const differences = [];
  if (queue.settings != null && !isRecord(queue.settings)) {
    differences.push('settings (expected an object)');
  }
  if ((queue.settings?.delivery_paused ?? false) !== false) {
    differences.push('settings.delivery_paused (expected false)');
  }
  const deliveryDelay = queue.settings?.delivery_delay ?? 0;
  if (deliveryDelay !== 0) differences.push(queueSettingDifference('settings.delivery_delay', 0, deliveryDelay));

  const consumers = queue.consumers ?? [];
  if (!Array.isArray(consumers)) {
    differences.push('consumers (expected an array)');
  } else if (requireConsumer ? consumers.length !== 1 : consumers.length > 1) {
    const expected = requireConsumer ? '1 after deploy' : 'at most 1';
    differences.push('consumers.length (expected ' + expected + ', got ' + consumers.length + ')');
  } else if (consumers.length) {
    const [consumer] = consumers;
    if (!isRecord(consumer)) {
      differences.push('consumers[0] (expected an object)');
    } else {
      if (consumer.type !== 'worker') differences.push('consumers[0].type (expected worker)');
      differences.push(...queueWorkerDifferences(consumer, 'consumers[0]'));
      if ((consumer.dead_letter_queue ?? '') !== '') {
        differences.push('consumers[0].dead_letter_queue (expected no dead-letter queue)');
      }
      const settings = consumer.settings;
      if (!isRecord(settings)) {
        differences.push('consumers[0].settings (expected an object)');
      } else {
        if (settings.max_concurrency != null) {
          differences.push(queueSettingDifference('consumers[0].settings.max_concurrency', 'automatic', settings.max_concurrency));
        }
        for (const [key, expected] of Object.entries(CONSUMER_SETTINGS)) {
          const actual = settings[key] ?? CONSUMER_DEFAULTS[key];
          if (actual !== expected) {
            differences.push(queueSettingDifference('consumers[0].settings.' + key, expected, actual));
          }
        }
      }
    }
  }

  const producers = queue.producers ?? [];
  if (!Array.isArray(producers)) {
    differences.push('producers (expected an array)');
    return differences;
  }
  for (const [index, producer] of producers.entries()) {
    const path = 'producers[' + index + ']';
    if (producer?.type === 'worker') {
      differences.push(...queueWorkerDifferences(producer, path));
    } else if (producer?.type === 'r2_bucket') {
      if (producer.bucket_name !== BUCKET) differences.push(path + '.bucket_name (expected the migration bucket)');
    } else {
      differences.push(path + '.type (expected worker or r2_bucket)');
    }
  }
  return differences;
}

async function writeGroup(api) {
  const groups = await api.get('/tokens/permission_groups?name=' + encodeURIComponent(R2_WRITE)
    + '&scope=' + encodeURIComponent(R2_SCOPE));
  requireState(Array.isArray(groups), 'R2_PERMISSION_GROUPS_RESPONSE_INVALID');
  const group = unique(groups, 'name', R2_WRITE);
  requireState(ID.test(group?.id) && group.scopes?.includes(R2_SCOPE), 'R2_BUCKET_ITEM_WRITE_PERMISSION_GROUP_MISSING');
  return group;
}

function tokenPolicy(account, group) {
  return {
    effect: 'allow',
    resources: { [R2_SCOPE + '.' + account + '_default_' + BUCKET]: '*' },
    permission_groups: [{ id: group.id, name: R2_WRITE }],
  };
}

function sameTokenPolicy(token, desired) {
  const [policy] = token.policies ?? [];
  return token.status === 'active' && token.policies?.length === 1 && policy.effect === desired.effect
    && Object.keys(policy.resources ?? {}).length === 1
    && policy.resources[Object.keys(desired.resources)[0]] === '*'
    && policy.permission_groups?.length === 1 && policy.permission_groups[0].id === desired.permission_groups[0].id
    && !Object.keys(policy.condition ?? {}).length && !Object.keys(token.condition ?? {}).length
    && !token.expires_on && !token.not_before;
}

async function inspect(infra, deploy, account, origin) {
  const [databases, queue, tokens, worker, workflow, group] = await Promise.all([
    infra.pages('/d1/database'), inspectQueue(infra), infra.pages('/tokens'), inspectWorker(deploy),
    deploy.get('/workflows/' + WORKFLOW, true), writeGroup(infra),
  ]);
  const database = unique(databases, 'name', DATABASE);
  if (database) requireState(UUID.test(database.uuid), 'MIGRATION_D1_ID_INVALID');
  const listedToken = unique(tokens, 'name', TOKEN);
  if (listedToken) requireState(ID.test(listedToken.id), 'MIGRATION_R2_TOKEN_ID_INVALID');
  const [bucket, token] = await Promise.all([
    inspectBucket(infra, queue, origin), listedToken ? infra.get('/tokens/' + listedToken.id) : null,
  ]);
  const policy = tokenPolicy(account, group);
  const secretsReady = SECRET_NAMES.every(name => worker.secrets.includes(name));
  const secretsPartial = SECRET_NAMES.some(name => worker.secrets.includes(name));
  const queueDifferences = queueConfigurationDifferences(queue);
  for (const [stage, event, present] of [
    ['d1-database', 'D1_DISCOVERED', !!database], ['queue', 'QUEUE_DISCOVERED', !!queue],
    ['r2-bucket', 'R2_BUCKET_DISCOVERED', bucket.bucket], ['worker', 'WORKER_DISCOVERED', worker.exists],
    ['workflow', 'WORKFLOW_DISCOVERED', !!workflow], ['r2-uploader', 'R2_UPLOADER_DISCOVERED', !!token],
  ]) checkTrace('cloudflare-api', stage, event, present ? 'OK' : 'NOT_OBSERVED', 'resource-present',
    present ? 'present' : 'missing');
  const scoped = !!token && sameTokenPolicy(token, policy);
  checkTrace('cloudflare-api', 'r2-uploader-scope', 'R2_UPLOADER_SCOPE_CHECK', !token ? 'NOT_OBSERVED' : scoped ? 'OK' : 'FAILED',
    'bucket-scoped-upload-token', scoped ? 'matches' : token ? 'configuration-conflict' : 'missing');
  for (const [kind, entries] of [['producer', queue?.producers], ['consumer', queue?.consumers]]) {
    const bad = queueDifferences.some(item => item.startsWith(kind + 's'));
    checkTrace('queue', 'queue-' + kind, 'QUEUE_' + kind.toUpperCase() + '_CHECK', bad ? 'FAILED' : entries?.length ? 'OK' : 'NOT_OBSERVED',
      'matching-' + kind + '-configuration', bad ? 'configuration-conflict' : entries?.length ? 'matches' : 'missing',
      { count: Array.isArray(entries) ? entries.length : undefined });
  }
  const conflicts = [
    ...(!bucket.private ? ['R2_BUCKET_IS_PUBLIC'] : []),
    ...(bucket.cors === 'conflict' ? ['R2_CORS_CONFLICT'] : []),
    ...(bucket.notificationConflict ? [bucket.notificationConflict] : []),
    ...(queueDifferences.length ? ['QUEUE_CONFIGURATION_CONFLICT: ' + queueDifferences.join(', ')] : []),
    ...(!worker.owned || !worker.private ? ['WORKER_OWNERSHIP_OR_PUBLIC_URL_CONFLICT'] : []),
    ...(workflow && (workflow.script_name !== WORKER || workflow.class_name !== 'MigrationWorkflow')
      ? ['WORKFLOW_OWNERSHIP_CONFLICT'] : []),
    ...(token && !sameTokenPolicy(token, policy) ? ['R2_TOKEN_POLICY_CONFLICT'] : []),
    ...(token && !secretsReady ? ['R2_CREDENTIALS_LOST_OR_PARTIAL: matching token exists but Worker secrets are missing; review and explicitly revoke only the migration uploader before rerunning apply'] : []),
    ...(!token && secretsPartial ? ['R2_WORKER_SECRETS_WITHOUT_MATCHING_TOKEN'] : []),
    ...(!token && worker.exists && !secretsPartial ? ['EXISTING_WORKER_WITHOUT_MIGRATION_TOKEN_REQUIRES_REVIEW'] : []),
  ];
  return { database, queue, bucket, token, worker, workflow, secretsReady, policy, conflicts };
}

async function report(operation, state) {
  const lines = [
    '## Mezfit migration infrastructure (' + operation + ')',
    '- D1: ' + (state.database ? 'present' : 'create'),
    '- Queue: ' + (state.queue ? 'present' : 'create'),
    '- R2: ' + (state.bucket.bucket ? 'present' : 'create private bucket'),
    '- R2 CORS: ' + state.bucket.cors,
    '- R2 notification: ' + state.bucket.notifications,
    '- Worker: ' + (state.worker.exists ? 'present' : 'create private Worker with uploader secrets'),
    '- Workflow: ' + (state.workflow ? 'present' : 'create during deploy'),
    '- R2 uploader: ' + (state.token ? 'present' : 'create'),
    '- Worker uploader secrets: ' + (state.secretsReady ? 'present' : 'missing'),
    ...state.conflicts.map(issue => '- Conflict: ' + issue),
  ];
  checkTrace('github', 'infrastructure-state', 'INFRASTRUCTURE_COMPARISON', state.conflicts.length ? 'FAILED' : 'OK',
    'no-configuration-conflicts', state.conflicts.length ? 'configuration-conflict' : 'no-conflicts', { count: state.conflicts.length });
  checkTrace('github', 'infrastructure-state', 'INFRASTRUCTURE_RESOURCE_GAPS', missingResources(state).length ? 'NOT_OBSERVED' : 'OK',
    'required-resources-present', missingResources(state).length ? 'missing-resources' : 'ready', { count: missingResources(state).length });
  const summary = lines.join('\n') + '\n';
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
}

function runWrangler(args, hideOutput = false) {
  const binary = fileURLToPath(new URL('../node_modules/.bin/wrangler', import.meta.url));
  const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
  delete env.CLOUDFLARE_BOOTSTRAP_API_TOKEN;
  const operation = args.includes('--version') ? 'version' : args.includes('list') ? 'migrations-list'
    : args[0] === 'd1' ? 'migrations-apply' : 'deploy';
  const start = Date.now();
  runnerTrace('wrangler', 'wrangler-' + operation, 'WRANGLER_COMMAND', 'STARTED', { expected: 'exit-0', details: { operation } });
  const result = spawnSync(binary, args, { env, stdio: 'pipe', encoding: 'utf8', timeout: 180000 });
  const output = result.stdout ?? '';
  const codes = [...((result.stderr ?? '') + output).matchAll(/\[code: (\d+)\]/g)].map(match => Number(match[1]));
  if (!hideOutput) {
    const version = /(?:^|\s)(\d{1,3}\.\d{1,4}\.\d{1,4})(?:\s|$)/.exec(output)?.[1];
    if (operation === 'version' && version) checkTrace('wrangler', 'wrangler-version', 'WRANGLER_VERSION', 'OK', 'pinned-version', 'found', { version });
    for (const line of output.split('\n')) {
      const migration = /\b(000[1-9]_[a-z0-9_]+\.sql)\b/.exec(line)?.[1];
      if (migration) checkTrace('d1', 'd1-migration', 'D1_MIGRATION', line.includes('✅') ? 'OK' : line.includes('❌') ? 'FAILED' : 'STARTED',
        'migration-applied', line.includes('✅') ? 'applied' : line.includes('❌') ? 'failed' : 'listed', { migration, table: 'd1_migrations' });
      if (/Uploaded mezfit-migration\b/.test(line)) checkTrace('wrangler', 'worker-upload', 'WRANGLER_WORKER_UPLOAD', 'OK', 'uploaded', 'uploaded');
      if (/Producer for mezfit-migration-events/.test(line)) checkTrace('queue', 'producer-deploy', 'QUEUE_PRODUCER_REGISTERED', 'OK', 'registered', 'registered');
      if (/Consumer for mezfit-migration-events/.test(line)) checkTrace('queue', 'consumer-deploy', 'QUEUE_CONSUMER_REGISTERED', 'OK', 'registered', 'registered');
      if (/workflow: mezfit-migration-workflow/.test(line)) checkTrace('workflow', 'workflow-deploy', 'WORKFLOW_REGISTERED', 'OK', 'registered', 'registered');
    }
    const versionId = /Current Version ID: ([a-f0-9-]{36})/i.exec(output)?.[1];
    if (versionId) workerVersion = versionId;
  }
  runnerTrace('wrangler', 'wrangler-' + operation, 'WRANGLER_COMMAND', result.status === 0 ? 'OK' : 'FAILED', {
    expected: 'exit-0', actual: result.status === 0 ? 'exit-0' : 'command-failed', duration_ms: Date.now() - start,
    error_code: result.status === 0 ? undefined : 'WRANGLER_FAILED', details: { operation, cf_codes: codes },
  });
  if (result.status === 0) return;
  if (hideOutput) {
    // Print numeric API codes only. Wrangler output can include submitted bindings.
    const codes = [...(result.stderr ?? '').matchAll(/\[code: (\d+)\]/g)].map(match => match[1]);
    throw new Error('PRIVATE_WORKER_SECRET_DEPLOY_FAILED using CLOUDFLARE_API_TOKEN'
      + ' (Workers Scripts Edit; Cloudflare codes: ' + (codes.join(', ') || 'none') + ')');
  }
  throw new Error('WRANGLER_FAILED ' + args.slice(0, 3).join(' '));
}

async function withConfig(account, databaseId, action, secretValues) {
  const path = fileURLToPath(new URL('./wrangler.json', import.meta.url));
  checkTrace('wrangler', 'wrangler-config', 'WRANGLER_CONFIG_BUILD', 'STARTED', 'isolated-config', 'building');
  const config = JSON.parse(await readFile(path, 'utf8'));
  config.vars.CLOUDFLARE_ACCOUNT_ID = account;
  if (databaseId) {
    config.d1_databases[0].database_id = databaseId;
  } else {
    // The initial deployment publishes secrets. The independent deploy enables processing.
    delete config.d1_databases;
    delete config.r2_buckets;
    delete config.queues;
    delete config.workflows;
  }
  const configFile = fileURLToPath(new URL('./.wrangler.' + randomUUID() + '.json', import.meta.url));
  const temp = secretValues ? await mkdtemp(join(tmpdir(), 'mezfit-migration-')) : null;
  try {
    await writeFile(configFile, JSON.stringify(config), { flag: 'wx' });
    const secretFile = temp ? join(temp, 'secrets.json') : null;
    if (secretFile) await writeFile(secretFile, JSON.stringify(secretValues), { mode: 0o600, flag: 'wx' });
    checkTrace('wrangler', 'wrangler-config', 'WRANGLER_CONFIG_BUILD', 'OK', 'isolated-config', 'generated');
    await action(configFile, secretFile);
  } finally {
    await rm(configFile, { force: true });
    if (temp) await rm(temp, { recursive: true, force: true });
  }
}

async function publishMigrationSecrets(account, secrets) {
  await withConfig(account, null, (configFile, secretFile) =>
    runWrangler(['deploy', '--config', configFile, '--secrets-file', secretFile], true), secrets);
}

export async function apply(infra, deploy, state, account, origin, publishSecrets = publishMigrationSecrets) {
  const { database, queue, bucket, token, policy } = state;
  if (!database) await infra.request('/d1/database', { method: 'POST', body: { name: DATABASE } });
  if (!bucket.bucket) await infra.request('/r2/buckets', { method: 'POST', body: { name: BUCKET } });
  const target = queue ?? (await infra.request('/queues', { method: 'POST', body: { queue_name: QUEUE } })).result;
  requireState(ID.test(target?.queue_id), 'MIGRATION_QUEUE_CREATE_RESPONSE_INVALID');
  const current = await inspectBucket(infra, target, origin);
  requireState(current.bucket && current.private && current.cors !== 'conflict' && current.notifications !== 'conflict',
    'MIGRATION_BUCKET_CHANGED_DURING_APPLY' + (current.notificationConflict ? ': ' + current.notificationConflict : ''));
  if (current.cors === 'missing') {
    await infra.request(BUCKET_PATH + '/cors', { method: 'PUT', body: desiredCors(origin) });
  }
  if (current.notifications === 'missing') {
    await infra.request(NOTIFICATIONS + '/queues/' + target.queue_id, { method: 'PUT', body: { rules: [RULE] } });
  }
  if (!token) {
    const [preflight, currentTokens] = await Promise.all([inspectWorker(deploy), infra.pages('/tokens')]);
    requireState(preflight.owned && preflight.private && !preflight.exists,
      'EXISTING_WORKER_WITHOUT_MIGRATION_TOKEN_REQUIRES_REVIEW');
    requireState(!unique(currentTokens, 'name', TOKEN), 'MIGRATION_TOKEN_APPEARED_DURING_APPLY: rerun preview');
    const minted = (await infra.request('/tokens', {
      method: 'POST', body: { name: TOKEN, policies: [policy] },
    })).result;
    requireState(ID.test(minted?.id) && typeof minted.value === 'string' && minted.value.length,
      'R2_TOKEN_CREATED_WITHOUT_USABLE_CREDENTIALS');
    const secretValues = {
      [SECRET_NAMES[0]]: minted.id,
      [SECRET_NAMES[1]]: createHash('sha256').update(minted.value).digest('hex'),
    };
    await publishSecrets(account, secretValues);
  }
}

function missingResources(state) {
  return [
    [state.database, 'D1'], [state.queue, 'Queue'], [state.bucket.bucket, 'R2 bucket'],
    [state.bucket.cors === 'current', 'R2 CORS'], [state.bucket.notifications === 'current', 'R2 notification'],
    [state.token, 'R2 uploader'], [state.secretsReady, 'Worker Secrets'],
  ].filter(([ready]) => !ready).map(([, name]) => name);
}

function requireProvisioned(state) {
  const missing = missingResources(state);
  requireState(!missing.length, 'MIGRATION_BOOTSTRAP_INCOMPLETE: ' + missing.join(', ') + '; run migration-bootstrap apply');
}

async function verifyReadback(infra, deploy, account, origin, deploying) {
  for (let attempt = 0; ; attempt++) {
    const state = await inspect(infra, deploy, account, origin);
    if (state.conflicts.length) {
      await report('readback', state);
      throw new Error('MIGRATION_INFRASTRUCTURE_READBACK_CONFLICT');
    }
    const missing = missingResources(state);
    if (deploying && !state.workflow) missing.push('Cloudflare Workflow');
    if (deploying && state.queue?.consumers?.length !== 1) missing.push('Queue consumer');
    if (deploying && state.worker.exists && !state.worker.observability) missing.push('Workers Logs readback');
    if (!missing.length) {
      checkTrace('github', 'infrastructure-ready', 'INFRASTRUCTURE_READY', 'OK', 'deployed-resource-readback', 'verified');
      return state;
    }
    runnerTrace('github', 'infrastructure-ready', 'INFRASTRUCTURE_READBACK_RETRY', 'RETRY', {
      attempt: attempt + 1, actual: 'awaiting-ready-resources', details: { count: missing.length, delay_ms: 1000 * 2 ** attempt },
    });
    requireState(attempt < 4, 'MIGRATION_INFRASTRUCTURE_READBACK_INCOMPLETE: ' + missing.join(', '));
    console.log('Awaiting Cloudflare readback: ' + missing.join(', '));
    await delay(1000 * 2 ** attempt);
  }
}

async function reportSmoke(lines) {
  const output = lines.join('\n') + '\n';
  console.log(output);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, '\n### Migration Smoke\n\n' + output + '\n');
  }
}

async function main() {
  const operation = process.env.MIGRATION_OPERATION ?? 'preview';
  const since = Date.now();
  const requested = process.env.MIGRATION_INSTANCE_ID;
  const id = operation === 'diagnose' && TRACE_ID.test(requested ?? '') ? requested : randomUUID();
  const runId = process.env.GITHUB_RUN_ID;
  const records = [];
  const runtime = { started: false };
  runnerTrace = (component, stage, event, status, fields) => traceWriter({
    trace_id: id, run_id: runId, instance_id: runtime.started || operation === 'diagnose' ? id : undefined,
    worker_version: workerVersion,
    ...(operation === 'processor-smoke' ? { job_id: id, processor_version: PROCESSOR_VERSION } : {}),
  }, row => { records.push(row); console.log(JSON.stringify(row)); })(component, stage, event, status, fields);
  const emit = runnerTrace;
  let deploy;
  let infra;
  let state;
  let failure;
  try {
    emit('github', 'actions-invocation', 'MIGRATION_ACTION_RUN', 'STARTED', {
      expected: 'operation-completed', details: { operation, sha: process.env.GITHUB_SHA },
    });
    emit('github', 'actions-inputs', 'MIGRATION_ACTION_INPUTS', 'OK', { actual: 'presence-checked', details: {
      has_account_id: !!process.env.CLOUDFLARE_ACCOUNT_ID, has_origin: !!process.env.MEZFIT_APP_ORIGIN,
      has_deploy_token: !!process.env.CLOUDFLARE_API_TOKEN, has_bootstrap_token: !!process.env.CLOUDFLARE_BOOTSTRAP_API_TOKEN,
    } });
    requireState(['preview', 'apply', 'deploy', 'diagnose', 'smoke', 'processor-smoke'].includes(operation), 'MIGRATION_OPERATION_INVALID');
    if (operation === 'apply') requireState(process.env.MIGRATION_CONFIRMATION === 'APPLY_MEZFIT_MIGRATION_INFRASTRUCTURE',
      'MIGRATION_APPLY_CONFIRMATION_REQUIRED');
    const account = (process.env.CLOUDFLARE_ACCOUNT_ID ?? '').toLowerCase();
    deploy = new CloudflareApi(account, process.env.CLOUDFLARE_API_TOKEN, 'CLOUDFLARE_API_TOKEN');
    if (operation === 'diagnose') {
      await diagnoseSmoke(deploy, requested, reportSmoke);
      return;
    }
    const origin = appOrigin(process.env.MEZFIT_APP_ORIGIN);
    infra = new CloudflareApi(account, process.env.CLOUDFLARE_BOOTSTRAP_API_TOKEN, 'CLOUDFLARE_BOOTSTRAP_API_TOKEN');
    await capture(emit, 'cloudflare-api', 'account', 'CLOUDFLARE_ACCOUNT_READ', () => infra.get(''),
      result => ({ actual: result ? 'account-confirmed' : 'account-unavailable' }));
    state = { ...await inspect(infra, deploy, account, origin), origin };
    await report(operation, state);
    if (operation === 'preview') return;
    requireState(!state.conflicts.length, 'MIGRATION_INFRASTRUCTURE_CONFLICT: see summary');
    if (operation === 'apply' || operation === 'deploy') runWrangler(['--version']);
    if (operation === 'apply') {
      await apply(infra, deploy, state, account, origin);
    } else {
      requireProvisioned(state);
      if (operation === 'deploy') {
        await withConfig(account, state.database.uuid, configFile => {
          runWrangler(['d1', 'migrations', 'list', 'JOBS', '--remote', '--config', configFile]);
          runWrangler(['d1', 'migrations', 'apply', 'JOBS', '--remote', '--config', configFile]);
          runWrangler(['deploy', '--config', configFile]);
        });
      }
    }
    state = { ...await verifyReadback(infra, deploy, account, origin, operation !== 'apply'), origin };
    if (operation === 'deploy' || operation === 'smoke') {
      emit('github', 'smoke-transition', 'SMOKE_START', 'STARTED', { expected: 'workflow-created' });
      runtime.started = true;
      await runSmoke(deploy, reportSmoke, { id, runId, emit, runtime });
    } else if (operation === 'processor-smoke') {
      workerVersion = await deployedWorkerVersion(deploy);
      await runProcessorSmoke(deploy, id, workerVersion, emit, runtime, { runId });
      await reportSmoke(['MIGRATION_PROCESSOR_SMOKE_OK']);
    }
  } catch (error) {
    failure = error;
    emit('github', 'actions-invocation', 'MIGRATION_ACTION_RUN', 'FAILED', {
      error_code: safeStatusFailure(error, 'MIGRATION_ACTION_FAILED'), duration_ms: Date.now() - since,
      expected: 'operation-completed', actual: 'operation-failed', details: { operation, classification: classifyTraceError(error) },
    });
    throw error;
  } finally {
    if (!failure) emit('github', 'actions-invocation', 'MIGRATION_ACTION_RUN', 'OK', {
      duration_ms: Date.now() - since, actual: 'operation-completed', details: { operation },
    });
    try {
      await finalTrace({ id, operation, runtime, records, deploy, infra, state, emit, failure, since });
    } catch (error) {
      emit('github', 'trace-collection', 'TRACE_REPORT_FAILED', 'NOT_OBSERVED', { actual: 'partial',
        error_code: 'TRACE_REPORT_FAILED', details: { classification: classifyTraceError(error) } });
      if (!failure) throw new Error('MIGRATION_TRACE_REPORT_FAILED');
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(safeStatusFailure(error, 'MIGRATION_ACTION_FAILED'));
    process.exitCode = 1;
  });
}
