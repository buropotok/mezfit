import { describe, expect, it, vi } from 'vitest';
import { deployedWorkerVersion, runProcessorSmoke } from './processor-control.mjs';
import { historyRecords, summarizeTrace, workerRecords } from './trace-collector.mjs';

const id = '4fe7581a-62c8-407d-bae6-6ddfe8067036';
const current = 'c89a8a4d-18c9-4eb5-9dfa-af79cfc455ef';
const old = '279fd1e0-057c-48df-b77d-612ed8c5b99b';
const noWait = async () => {};

function setup(versions, cleanupStatus = 'complete') {
  const operations = [];
  const instances = new Map();
  const emit = vi.fn();
  const api = {
    request: vi.fn(async (_path, { body }) => {
      const operation = body.params.operation;
      operations.push(operation);
      const instance = operation === 'processor-ready'
        ? { status: 'complete', output: 'MIGRATION_PROCESSOR_READY:' + versions.shift() }
        : operation === 'processor-smoke' ? { status: 'complete', output: '"MIGRATION_PROCESSOR_SMOKE_VERIFIED"' }
          : { status: cleanupStatus, output: 'MIGRATION_PROCESSOR_CLEANUP_OK' };
      instances.set(body.instance_id, instance);
    }),
    get: vi.fn(async path => instances.get(path.split('/').at(-1))),
  };
  return { api, emit, operations };
}

describe('deployed processor smoke', () => {
  it('reads the active Worker version from the deployment response', async () => {
    const api = { get: vi.fn(async () => ({
      deployments: [{ versions: [{ version_id: current, percentage: 100 }] }],
    })) };
    await expect(deployedWorkerVersion(api)).resolves.toBe(current);
    api.get.mockResolvedValueOnce({ deployments: [{ versions: [{ version_id: old, percentage: 50 }] }] });
    await expect(deployedWorkerVersion(api)).rejects.toThrow('DEPLOYED_VERSION_UNCONFIRMED');
  });

  it('waits for the actual runtime version before writing a fixture or checking cleanup', async () => {
    const { api, emit, operations } = setup([old, current]);
    const runtime = { started: false };
    await runProcessorSmoke(api, id, current, emit, runtime, { wait: noWait });
    expect(runtime.started).toBe(true);
    expect(operations).toEqual(['processor-ready', 'processor-ready', 'processor-smoke', 'processor-cleanup']);
    expect(emit).toHaveBeenCalledWith('workflow', 'processor-readiness', 'DEPLOYED_VERSION_CHECK', 'RETRY',
      expect.objectContaining({ error_code: 'DEPLOYED_VERSION_NOT_READY' }));
    expect(api.request.mock.calls[2][1].body.params).toMatchObject({ jobId: id, expectedVersion: current });
  });

  it('reports a bounded readiness failure without starting the smoke', async () => {
    const { api, emit, operations } = setup(Array(5).fill(old));
    const runtime = { started: false };
    await expect(runProcessorSmoke(api, id, current, emit, runtime, { wait: noWait })).rejects.toThrow('DEPLOYED_VERSION_NOT_READY');
    expect(runtime.started).toBe(false);
    expect(operations).toEqual(Array(5).fill('processor-ready'));
  });

  it('fails acceptance when cleanup cannot be confirmed', async () => {
    const { api, emit } = setup([current], 'errored');
    await expect(runProcessorSmoke(api, id, current, emit, {}, { wait: noWait })).rejects.toThrow('PROCESSOR_SMOKE_CLEANUP_FAILED');
    expect(emit).toHaveBeenCalledWith('cleanup', 'processor-smoke-cleanup', 'PROCESSOR_CLEANUP_CONTROL', 'FAILED',
      expect.objectContaining({ error_code: 'PROCESSOR_SMOKE_CLEANUP_FAILED' }));
  });

  it('reports unknown stages separately from confirmed failures and captures only observed CPU usage', () => {
    const timestamp = Date.parse('2026-11-17T00:00:00.123Z');
    const note = { trace_id: id, component: 'processor', stage: 'record-validation', event: 'RECORD_VALIDATION_FAILED',
      status: 'FAILED', timestamp: new Date(timestamp).toISOString(), error_code: 'INVALID_INPUT_SCHEMA' };
    const unrelated = { requestId: 'unrelated', cpuTimeMs: 8 };
    const observed = { requestId: 'matching', cpuTimeMs: 2.4 };
    const { records } = workerRecords({ events: { events: [
      { source: note, timestamp, $workers: { requestId: 'matching' } },
      { source: {}, timestamp, $workers: unrelated },
      { source: {}, timestamp, $workers: observed },
    ] } }, id);
    expect(records.filter(row => row.event === 'WORKERS_INVOCATION_CPU').map(row => row.details.cpu_ms)).toEqual([2.4]);
    const report = summarizeTrace(records, true, { workflow: false }, true);
    expect(report.first_confirmed_failure.error_code).toBe('INVALID_INPUT_SCHEMA');
    expect(report.stages).toEqual(expect.arrayContaining([
      { stage: 'queue-delivery', status: 'NOT_OBSERVED' }, { stage: 'result-put', status: 'NOT_REACHED' },
    ]));
    expect(historyRecords({ steps: [{ name: 'Read and process migration input', attempts: [{
      start: note.timestamp, end: note.timestamp, success: false, error: { message: 'Worker exceeded CPU time limit' },
    }] }] }, id).at(-1)).toMatchObject({ error_code: 'WORKFLOW_CPU_LIMIT' });
  });
});

describe('processor smoke cleanup after controller failure', () => {
  it('retains the primary failure when cleanup fails too and records cleanup separately', async () => {
    const { api, emit, operations } = setup([current], 'errored');
    const get = api.get.getMockImplementation();
    api.get.mockImplementation(path => path.endsWith('/' + id) ? { status: 'errored' } : get(path));
    await expect(runProcessorSmoke(api, id, current, emit, {}, { wait: noWait }))
      .rejects.toThrow('MIGRATION_PROCESSOR_SMOKE_FAILED');
    expect(operations).toEqual(['processor-ready', 'processor-smoke', 'processor-cleanup']);
    expect(emit).toHaveBeenCalledWith('cleanup', 'processor-smoke-cleanup', 'PROCESSOR_CLEANUP_CONTROL', 'FAILED',
      expect.objectContaining({ error_code: 'PROCESSOR_SMOKE_CLEANUP_FAILED' }));
  });

  it.each(['paused', 'unknown'])('defers cleanup when the smoke instance status is %s', async status => {
    const { api, emit, operations } = setup([current]);
    const get = api.get.getMockImplementation();
    api.get.mockImplementation(path => path.endsWith('/' + id) ? { status } : get(path));
    await expect(runProcessorSmoke(api, id, current, emit, {}, { wait: noWait })).rejects.toThrow('MIGRATION_PROCESSOR_SMOKE_FAILED');
    expect(operations).toEqual(['processor-ready', 'processor-smoke']);
    expect(emit).toHaveBeenCalledWith('cleanup', 'processor-smoke-cleanup', 'PROCESSOR_CLEANUP_CONTROL', 'NOT_OBSERVED',
      expect.objectContaining({ error_code: 'PROCESSOR_SMOKE_CLEANUP_DEFERRED' }));
  });

  it('recognizes the cleanup Workflow history while prioritizing the original smoke failure', () => {
    const start = '2026-11-17T00:00:00.000Z';
    const end = '2026-11-17T00:00:01.000Z';
    const cleanup = historyRecords({ steps: [{ name: 'Verify and remove processor smoke resources', attempts: [{
      start, end, success: false, error: { message: 'PROCESSOR_CLEANUP_INCOMPLETE' },
    }] }] }, id);
    const smoke = historyRecords({ steps: [{ name: 'Verify processor fixture result', attempts: [{
      start, end, success: false, error: { message: 'PROCESSOR_SMOKE_RESULT_INVALID' },
    }] }] }, id);
    expect(cleanup.at(-1)).toMatchObject({ stage: 'verify-and-remove-processor-smoke-resources',
      error_code: 'PROCESSOR_CLEANUP_INCOMPLETE', status: 'FAILED' });
    expect(summarizeTrace([...cleanup, ...smoke], true, { workflow: true }, true).first_confirmed_failure)
      .toMatchObject({ error_code: 'PROCESSOR_SMOKE_RESULT_INVALID' });
  });
});
