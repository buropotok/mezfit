export const TRACE_PREFIX = '_migration-traces/';
export const TRACE_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const COMPONENT = new Set(['github', 'cloudflare-api', 'wrangler', 'r2', 'queue', 'consumer', 'd1', 'workflow', 'cleanup', 'processor']);
const STATUS = new Set(['STARTED', 'OK', 'FAILED', 'RETRY', 'SKIPPED', 'NOT_OBSERVED', 'NOT_REACHED']);
const LABEL = /^[A-Za-z][A-Za-z0-9_.:-]{0,94}$/;
const NUMBER_KEYS = new Set(['http_status', 'batch_size', 'size', 'expected_size', 'affected_rows', 'timeout_ms', 'retry_limit',
  'delay_ms', 'remaining_ms', 'backlog_count', 'backlog_bytes', 'oldest_message_timestamp_ms', 'delivery_ms', 'count',
  'producer_count', 'consumer_count', 'rule_count', 'poll', 'ttl_seconds', 'timestamp_ms', 'max_batch_timeout_ms',
  'max_retries', 'retry_delay', 'max_concurrency', 'sampling', 'offset', 'cpu_ms']);
const BOOL_KEYS = new Set(['matched', 'exists', 'etag_matches', 'mime_matches', 'size_matches', 'private', 'cors_current',
  'prefix_filter', 'suffix_filter', 'has_account', 'has_bucket', 'has_action', 'has_object', 'has_event_time', 'has_marker',
  'has_credentials', 'has_deploy_token', 'has_bootstrap_token', 'has_origin', 'has_account_id', 'invocation_logs',
  's3_code_present', 'enabled', 'logs_enabled', 'more', 'replay', 'promoted', 'duplicate', 'managed', 'can_retry', 'present', 'truncated']);
const TOKEN_KEYS = {
  s3_content_type: new Set(['xml', 'json', 'html', 'text', 'other', 'absent']),
  s3_body_format: new Set(['s3-xml', 'opaque', 'empty', 'truncated', 'unread']),
  field: new Set(['envelope', 'account', 'bucket', 'action', 'object', 'object.key', 'object.size', 'object.eTag', 'eventTime', 'smokeReplay', 'processorReplay']),
  action: new Set(['PutObject', 'CopyObject', 'CompleteMultipartUpload']),
  method: new Set(['GET', 'POST', 'PUT', 'DELETE', 'HEAD']),
  sql: new Set(['SELECT', 'INSERT', 'UPDATE', 'BATCH']),
  table: new Set(['migration_jobs', 'migration_smoke_replays', 'd1_migrations', 'migration_executions']),
  backoff: new Set(['constant', 'linear', 'exponential']),
  operation: new Set(['preview', 'apply', 'deploy', 'diagnose', 'smoke', 'cleanup', 'processor-smoke', 'nested-smoke', 'version', 'migrations-list', 'migrations-apply']),
  classification: new Set(['network', 'timeout', 'abort', 'dns_tls', 'runtime', 'storage', 'cpu_limit', 'memory_limit', 'unknown']),
  source: new Set(['workers_logs', 'r2_trace', 'workflow_history', 'queue_metrics', 'runtime', 'configuration']),
  mime: new Set(['application/octet-stream', 'application/zip', 'application/gzip', 'application/x-sqlite3', 'application/vnd.sqlite3']),
  state: new Set(['uploaded', 'rejected', 'missing', 'unknown', 'queued', 'running', 'succeeded', 'failed', 'unsupported']),
  bucket: new Set(['mezfit-migration-uploads']),
  queue: new Set(['mezfit-migration-events']),
  binding: new Set(['UPLOADS', 'JOBS', 'EVENTS', 'MIGRATION_WORKFLOW', 'MIGRATION_VERSION',
    'MIGRATION_R2_ACCESS_KEY_ID', 'MIGRATION_R2_SECRET_ACCESS_KEY']),
};
const ENDPOINTS = new Set(['account', 'd1-databases', 'd1-query', 'queues', 'queue-details', 'queue-metrics', 'r2-buckets',
  'r2-bucket', 'r2-domains-custom', 'r2-domains-managed', 'r2-cors', 'r2-notifications', 'r2-notification-rule',
  'r2-objects', 'r2-object', 'token-list', 'token-details', 'token-permission-groups', 'worker-settings', 'worker-deployments', 'worker-secrets',
  'worker-subdomain', 'workflow', 'workflow-instances', 'workflow-instance', 'workers-telemetry', 'other']);
function safeDetails(input) {
  const result = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    if ((NUMBER_KEYS.has(key) && typeof value === 'number' && Number.isFinite(value))
      || (BOOL_KEYS.has(key) && typeof value === 'boolean') || (Object.hasOwn(TOKEN_KEYS, key) && TOKEN_KEYS[key].has(value))
      || (key === 'endpoint' && ENDPOINTS.has(value))
      || (key === 'sha' && typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value))
      || (key === 'adapter_id' && typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value))
      || (key === 'adapter_version' && typeof value === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value))
      || (key === 'version' && typeof value === 'string' && /^\d{1,3}\.\d{1,4}\.\d{1,4}$/.test(value))
      || (key === 'migration' && typeof value === 'string' && /^000[1-9]_[a-z0-9_]{1,60}\.sql$/.test(value))
      || (key === 'message_id' && typeof value === 'string' && /^(?:[a-f0-9]{16,64}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(value))) result[key] = value;
    if (key === 'cf_codes' && Array.isArray(value)) result[key] = value.filter(Number.isSafeInteger).slice(0, 12);
  }
  return result;
}
const cleanLabel = value => typeof value === 'string' && LABEL.test(value) ? value : null;
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const timestamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) ? value : null;

export function sanitizeTrace(input) {
  if (!input || !COMPONENT.has(input.component) || !STATUS.has(input.status) || !timestamp(input.timestamp)
    || !cleanLabel(input.stage) || !cleanLabel(input.event)) return null;
  const instance = input.workflow_instance_id ?? input.instance_id;
  return {
    timestamp: input.timestamp, trace_id: TRACE_ID.test(input.trace_id ?? '') ? input.trace_id : null,
    run_id: typeof input.run_id === 'string' && /^\d{1,24}$/.test(input.run_id) ? input.run_id : null,
    instance_id: TRACE_ID.test(instance ?? '') || /^process-v[1-9][0-9]{0,3}-[a-f0-9-]{36}$/.test(instance ?? '') ? instance : null,
    workflow_instance_id: TRACE_ID.test(instance ?? '') || /^process-v[1-9][0-9]{0,3}-[a-f0-9-]{36}$/.test(instance ?? '') ? instance : null,
    job_id: TRACE_ID.test(input.job_id ?? '') ? input.job_id : null,
    processor_version: typeof input.processor_version === 'string' && /^v[1-9][0-9]{0,3}$/.test(input.processor_version)
      ? input.processor_version : null,
    component: input.component, stage: input.stage, event: input.event, status: input.status,
    attempt: integer(input.attempt), duration_ms: integer(input.duration_ms), error_code: cleanLabel(input.error_code),
    expected: cleanLabel(input.expected), actual: cleanLabel(input.actual),
    worker_version: UUID.test(input.worker_version ?? '') ? input.worker_version : null, details: safeDetails(input.details),
  };
}

export function traceWriter(context, sink = record => console.log(record)) {
  return (component, stage, event, status, fields = {}) => {
    const record = sanitizeTrace({ ...fields, ...context, timestamp: new Date().toISOString(), component, stage, event, status });
    if (record) sink(record);
  };
}

export function classifyTraceError(error) {
  const name = error?.name;
  const code = error?.cause?.code ?? error?.code;
  const message = typeof error?.message === 'string' ? error.message : '';
  if (code === 'exceededCpu' || message === 'WORKFLOW_CPU_LIMIT' || /\b(?:exceeded (?:the )?(?:maximum )?CPU(?: time)?(?: limit)?|CPU(?: time)? limit exceeded)\b/i.test(message)) return 'cpu_limit';
  if (code === 'exceededMemory' || message === 'WORKFLOW_MEMORY_LIMIT' || /\b(?:exceeded (?:the )?(?:maximum )?memory(?: limit)?|memory limit exceeded)\b/i.test(message)) return 'memory_limit';
  if (name === 'TimeoutError' || message === 'WORKFLOW_STEP_TIMEOUT' || code === 'ETIMEDOUT' || /^(?:operation |step )?timed out\b/i.test(message)) return 'timeout';
  if (name === 'AbortError') return 'abort';
  if (['ENOTFOUND', 'EAI_AGAIN', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(code)
    || /\b(?:DNS lookup|TLS handshake|certificate verify failed)\b/i.test(message)) return 'dns_tls';
  if (['ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)
    || /^(?:network (?:error|connection lost)|fetch failed)\b/i.test(message)) return 'network';
  if (/^D1_ERROR\b/i.test(message)) return 'storage';
  if (['TypeError', 'ReferenceError', 'RangeError', 'SyntaxError'].includes(name)) return 'runtime';
  return 'unknown';
}

export function traceStepName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/g, '');
}

export function smokeTraceId(key) {
  if (typeof key !== 'string' || !key.startsWith('smoke/')) return null;
  const id = key.split('/')[1];
  return TRACE_ID.test(id ?? '') ? id : null;
}
