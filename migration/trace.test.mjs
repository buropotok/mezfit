import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectRuntimeTrace, historyRecords, summarizeTrace, workflowStepName } from './trace-collector.mjs';
import { classifyTraceError, sanitizeTrace, traceWriter } from './trace.mjs';
import { consumeUploads, parseUploadEvent } from './worker/events';

const id = '4fe7581a-62c8-407d-bae6-6ddfe8067036';
const account = 'a'.repeat(32);
const timestamp = '2026-11-17T09:48:14.000Z';
const note = { timestamp, trace_id: id, component: 'consumer', stage: 'queue-message', event: 'QUEUE_MESSAGE_RECEIVED',
  status: 'OK', expected: 'queue-delivery', actual: 'message-received' };
const smokeEvent = { account, bucket: 'mezfit-migration-uploads', action: 'PutObject', eventTime: timestamp,
  object: { key: 'smoke/' + id, size: 23, eTag: 'c2c4344304438b96fbd9a2383b658334' } };
const noWait = async () => {};

afterEach(() => vi.restoreAllMocks());

describe('migration trace security and evidence', () => {
  it('keeps only allowlisted fields and separates timeout, network, and unknown failures', () => {
    const text = JSON.stringify(sanitizeTrace({ ...note, key: 'private-key', details: {
      authorization: 'Bearer credential', presigned: 'https://r2.example?X-Amz-Signature=secret',
      mime: 'private MIME string', http_status: 403, classification: 'unknown',
    } }));
    expect(text).not.toMatch(/credential|X-Amz|private-key|private MIME/);
    expect(text).toContain('"http_status":403');
    expect(classifyTraceError({ name: 'TimeoutError' })).toBe('timeout');
    expect(classifyTraceError({ cause: { code: 'ENOTFOUND' } })).toBe('dns_tls');
    expect(classifyTraceError({ cause: { code: 'ECONNRESET' } })).toBe('network');
    expect(classifyTraceError(new Error('opaque cloud error'))).toBe('unknown');
  });

  it('keeps missing R2 publication and Queue delivery distinct from a successful D1 query with no row', () => {
    const rows = [sanitizeTrace({ ...note, component: 'd1', stage: 'job-read', event: 'D1_JOB_SELECT',
      status: 'OK', expected: 'job-row', actual: 'row-missing' })];
    const summary = summarizeTrace(rows, true, { workflow: false });
    expect(summary.stages).toEqual(expect.arrayContaining([
      { stage: 'r2-notification-published', status: 'NOT_OBSERVED' },
      { stage: 'queue-message', status: 'NOT_OBSERVED' },
      { stage: 'job-read', status: 'OK' },
      { stage: 'replay-send', status: 'NOT_OBSERVED' },
    ]));
    expect(summary.first_confirmed_failure).toBeNull();
  });

  it('preserves attempt history, identifies named timeouts, and distinguishes non-reached steps', () => {
    const rows = historyRecords({ steps: [{ name: 'Observe R2 notification in D1-1', attempts: [
      { start: timestamp, end: timestamp, success: false, error: { name: 'TimeoutError', message: 'private detail' } },
    ] }] }, id);
    expect(workflowStepName('Observe R2 notification in D1-1')).toBe('Observe R2 notification in D1');
    expect(rows.at(-1)).toMatchObject({ stage: 'observe-r2-notification-in-d1', attempt: 1,
      error_code: 'WORKFLOW_STEP_TIMEOUT', expected: 'step-completed', actual: 'timeout' });
    expect(JSON.stringify(rows)).not.toContain('private detail');
    expect(summarizeTrace(rows, true, { workflow: true }).stages).toContainEqual({
      stage: 'verify-exact-queue-replay-receipt', status: 'NOT_REACHED',
    });
  });

  it('uses independent R2 evidence when Workers Logs permission is denied', async () => {
    const api = { request: vi.fn(async () => { throw Object.assign(new Error('forbidden'), { status: 403 }); }) };
    const key = '_migration-traces/' + id + '/' + id + '.json';
    const storage = { request: vi.fn(async (_, options) => options?.raw ? JSON.stringify([note])
      : { result: [{ key }, { key: '../private' }] }) };
    const output = await collectRuntimeTrace(api, storage, id, Date.now() - 5000, vi.fn(), { polls: 2, wait: noWait });
    expect(api.request).toHaveBeenCalledOnce();
    expect(output.coverage).toEqual({ workers_logs: 'permission-denied', r2_trace: 'received' });
    expect(output.records).toHaveLength(1);
    expect(storage.request.mock.calls.some(([path]) => path.includes('private'))).toBe(false);
  });

  it('retries delayed or transient telemetry, rejects foreign traces, and reports partial data', async () => {
    const api = { request: vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('delayed'), { status: 503 }))
      .mockResolvedValue({ result: { events: { count: 10, events: [
        { source: note }, { source: { ...note, trace_id: 'c5b3ba3f-a4a7-4484-8d9b-c5a392bf4aa1' } },
      ] } } }) };
    const storage = { request: vi.fn(async () => ({ result: [] })) };
    const output = await collectRuntimeTrace(api, storage, id, Date.now() - 5000, vi.fn(), { polls: 2, wait: noWait });
    expect(output.coverage).toEqual({ workers_logs: 'partial', r2_trace: 'empty' });
    expect(output.records).toHaveLength(1);
  });
});

describe('consumer step traces', () => {
  it.each([
    ['account', { account: 'private-value' }],
    ['bucket', { bucket: 'private-value' }],
    ['object.key', { object: { ...smokeEvent.object, key: 'smoke/' + id + '/private-value' } }],
    ['object.eTag', { object: { ...smokeEvent.object, eTag: 'private-value' } }],
  ])('identifies invalid %s without dumping the message', (field, change) => {
    const records = [];
    expect(parseUploadEvent({ ...smokeEvent, ...change }, account, traceWriter({ trace_id: id }, row => records.push(row)))).toBeNull();
    expect(records).toContainEqual(expect.objectContaining({ event: 'QUEUE_EVENT_REJECTED',
      error_code: 'QUEUE_EVENT_INVALID', expected: 'valid-upload-event', actual: 'invalid-event', details: { field } }));
    expect(JSON.stringify(records)).not.toContain('private-value');
  });

  it.each([
    ['R2', true, 'CONSUMER_R2_HEAD_FAILED'],
    ['D1', false, 'D1_JOB_BATCH_FAILED'],
  ])('logs %s failures before retry and preserves a correlated R2 trace', async (_type, failHead, expected) => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const head = { size: 23, etag: smokeEvent.object.eTag, httpMetadata: { contentType: 'application/octet-stream' } };
    const put = vi.fn(async () => null);
    const env = { CLOUDFLARE_ACCOUNT_ID: account,
      UPLOADS: { put, head: async () => { if (failHead) throw new Error('private-value'); return head; } },
      JOBS: { prepare: () => ({ bind: () => ({}) }), batch: async () => { throw new Error('private-value'); } },
    };
    const ack = vi.fn();
    const retry = vi.fn(() => expect(output.mock.calls.some(([entry]) => entry.event === 'QUEUE_MESSAGE_RETRY' && entry.status === 'RETRY')).toBe(true));
    await consumeUploads({ messages: [{ body: smokeEvent, ack, retry, attempts: 1, timestamp: new Date(timestamp) }] }, env);
    expect(ack).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledOnce();
    const persisted = JSON.parse(put.mock.calls[0][1]);
    expect(persisted).toEqual(expect.arrayContaining([expect.objectContaining({ trace_id: id, error_code: expected,
      actual: 'exception' })]));
    expect(JSON.stringify(persisted)).not.toContain('private-value');
  });

  it('acks an invalid message only after recording the decision and never mirrors trace-object notifications', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const put = vi.fn();
    const head = vi.fn();
    const ack = vi.fn(() => expect(output.mock.calls.some(([entry]) => entry.event === 'QUEUE_MESSAGE_ACK'
      && entry.status === 'STARTED')).toBe(true));
    const env = { CLOUDFLARE_ACCOUNT_ID: account, UPLOADS: { put, head }, JOBS: {} };
    await consumeUploads({ messages: [{ body: { ...smokeEvent, object: { key: '_migration-traces/' + id + '/' + id + '.json' } }, ack }] }, env);
    expect(ack).toHaveBeenCalledOnce();
    expect(head).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
});
