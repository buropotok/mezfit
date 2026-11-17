import { TRACE_ID, TRACE_PREFIX, traceWriter, classifyTraceError, type TraceContext, type TraceFields, type TraceRecord } from '../trace.mjs';

export type WorkerVersion = { id: string };
const FILE = /^[a-f0-9-]{36}\.json$/i;
export function isTraceObject(key: unknown): boolean {
  if (typeof key !== 'string' || !key.startsWith(TRACE_PREFIX)) return false;
  const [folder, file, extra] = key.slice(TRACE_PREFIX.length).split('/');
  return !extra && TRACE_ID.test(folder ?? '') && FILE.test(file ?? '');
}

export function workerTrace(bucket: R2Bucket, context: TraceContext) {
  const records: TraceRecord[] = [];
  const emit = traceWriter(context, record => {
    console.log(record);
    if (records.length < 200) records.push(record);
  });
  async function flush() {
    if (!context.instance_id || !context.trace_id || !TRACE_ID.test(context.trace_id) || !bucket?.put || !records.length) return;
    const start = Date.now();
    const consoleOnly = traceWriter(context);
    consoleOnly('r2', 'trace-persist', 'TRACE_FALLBACK_PUT', 'STARTED', { expected: 'stored-trace' });
    try {
      const key = TRACE_PREFIX + context.trace_id + '/' + crypto.randomUUID() + '.json';
      await bucket.put(key, JSON.stringify(records.splice(0)), { httpMetadata: { contentType: 'application/json' } });
      consoleOnly('r2', 'trace-persist', 'TRACE_FALLBACK_PUT', 'OK', { actual: 'stored-trace', duration_ms: Date.now() - start });
    } catch (error) {
      consoleOnly('r2', 'trace-persist', 'TRACE_FALLBACK_PUT', 'FAILED', { error_code: 'TRACE_FALLBACK_WRITE_FAILED',
        expected: 'stored-trace', actual: 'write-rejected', duration_ms: Date.now() - start,
        details: { classification: classifyTraceError(error) } });
    }
  }
  return { emit, flush };
}

export async function observed<T>(emit: ReturnType<typeof workerTrace>['emit'] | undefined,
  component: string, stage: string, event: string, fields: TraceFields, action: () => Promise<T>,
  result: (value: T) => TraceFields = () => ({ actual: 'completed' })): Promise<T> {
  const start = Date.now();
  emit?.(component, stage, event, 'STARTED', fields);
  try {
    const value = await action();
    const outcome = result(value);
    emit?.(component, stage, event, outcome.error_code ? 'FAILED' : 'OK', {
      ...fields, ...outcome, duration_ms: Date.now() - start,
    });
    return value;
  } catch (error) {
    emit?.(component, stage, event, 'FAILED', { ...fields, duration_ms: Date.now() - start,
      error_code: event + '_FAILED', actual: 'exception', details: { ...fields.details, classification: classifyTraceError(error) } });
    throw error;
  }
}
