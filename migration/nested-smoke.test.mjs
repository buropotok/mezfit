import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runProcessorSmoke } from './processor-control.mjs';
import { sanitizeTrace } from './trace.mjs';
import { summarizeTrace } from './trace-collector.mjs';

const id = '4fe7581a-62c8-407d-bae6-6ddfe8067036';
const current = 'c89a8a4d-18c9-4eb5-9dfa-af79cfc455ef';
const old = '279fd1e0-057c-48df-b77d-612ed8c5b99b';

function controller({ versions = [current], smokeOutput = 'MIGRATION_NESTED_SMOKE_VERIFIED',
  smokeStatus = 'complete', cleanupOutput = 'MIGRATION_PROCESSOR_CLEANUP_OK', cleanupStatus = 'complete', loseReply = false } = {}) {
  const instances = new Map();
  const emit = vi.fn();
  const operations = [];
  const api = {
    request: vi.fn(async (_path, { body }) => {
      operations.push(body.params);
      const operation = body.params.operation;
      instances.set(body.instance_id, operation === 'processor-ready'
        ? { status: 'complete', output: 'MIGRATION_PROCESSOR_READY:' + versions.shift() }
        : operation === 'processor-nested-smoke' ? { status: smokeStatus, output: smokeOutput }
          : { status: cleanupStatus, output: cleanupOutput });
      if (loseReply) { loseReply = false; throw Object.assign(new Error('lost reply'), { transient: true }); }
    }),
    get: vi.fn(async path => instances.get(path.split('/').at(-1))),
  };
  const runtime = {};
  return { api, emit, operations, runtime,
    run: (wait = async () => {}) => runProcessorSmoke(api, id, current, emit, runtime,
      { wait, operation: 'nested-smoke', runId: '123' }) };
}

afterEach(() => vi.restoreAllMocks());

describe('manual nested smoke controller', () => {
  it('uses the readiness gate and same instance after a lost dispatch reply, then requires confirmed cleanup', async () => {
    const job = controller({ versions: [old, current], loseReply: true });
    await expect(job.run()).resolves.toBe('MIGRATION_NESTED_SMOKE_OK');
    expect(job.operations.map(params => params.operation)).toEqual([
      'processor-ready', 'processor-ready', 'processor-nested-smoke', 'processor-cleanup',
    ]);
    expect(job.operations[2]).toMatchObject({ jobId: id, expectedVersion: current, runId: '123' });
    expect(job.operations[3].targetId).toBe(id);
    expect(job.emit).toHaveBeenCalledWith('workflow', 'processor-instance-create', 'PROCESSOR_CONTROL_CREATE', 'OK',
      { details: { operation: 'nested-smoke' } });
  });

  it.each([
    ['legacy fixture', { smokeOutput: 'MIGRATION_PROCESSOR_SMOKE_VERIFIED' }],
    ['missing output', { smokeOutput: null }],
    ['failed smoke', { smokeStatus: 'errored' }],
  ])('never accepts %s as nested verification', async (_name, options) => {
    const job = controller(options);
    await expect(job.run()).rejects.toThrow('MIGRATION_PROCESSOR_SMOKE_FAILED');
  });

  it.each([
    { cleanupStatus: 'errored' }, { cleanupOutput: 'unconfirmed' },
  ])('never returns the final marker for unconfirmed cleanup %j', async options => {
    await expect(controller(options).run()).rejects.toThrow('PROCESSOR_SMOKE_CLEANUP_FAILED');
  });

  it('preserves the primary failure and separately reports a cleanup failure', async () => {
    const job = controller({ smokeStatus: 'errored', cleanupStatus: 'errored' });
    await expect(job.run()).rejects.toThrow('MIGRATION_PROCESSOR_SMOKE_FAILED');
    expect(job.emit).toHaveBeenCalledWith('cleanup', 'processor-smoke-cleanup', 'PROCESSOR_CLEANUP_CONTROL', 'FAILED',
      expect.objectContaining({ error_code: 'PROCESSOR_SMOKE_CLEANUP_FAILED' }));
  });

  it('bounds old-version readiness without starting the smoke', async () => {
    const job = controller({ versions: Array(5).fill(old) });
    await expect(job.run()).rejects.toThrow('DEPLOYED_VERSION_NOT_READY');
    expect(job.operations.map(params => params.operation)).toEqual(Array(5).fill('processor-ready'));
  });

  it('defers cleanup when the controller times out while the Workflow remains running', async () => {
    const job = controller({ smokeStatus: 'running' });
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    await expect(job.run(async () => { now += 140000; })).rejects.toThrow('MIGRATION_PROCESSOR_SMOKE_FAILED');
    expect(job.operations.map(params => params.operation)).toEqual(['processor-ready', 'processor-nested-smoke']);
    expect(job.emit).toHaveBeenCalledWith('cleanup', 'processor-smoke-cleanup', 'PROCESSOR_CLEANUP_CONTROL', 'NOT_OBSERVED',
      expect.objectContaining({ error_code: 'PROCESSOR_SMOKE_CLEANUP_DEFERRED' }));
  });

  it('rejects an unknown operation before any cloud call', async () => {
    const job = controller();
    await expect(runProcessorSmoke(job.api, id, current, job.emit, {}, { operation: 'unknown' }))
      .rejects.toThrow('MIGRATION_OPERATION_INVALID');
    expect(job.api.request).not.toHaveBeenCalled();
  });

  it('preserves nested operation and adapter evidence in sanitized trace and stage summaries', () => {
    const timestamp = '2026-11-18T00:00:00.000Z';
    const record = sanitizeTrace({ timestamp, trace_id: id, component: 'processor', stage: 'adapter-selection',
      event: 'PROCESSOR_SMOKE_ADAPTER_VERIFIED', status: 'OK', details: {
        operation: 'nested-smoke', adapter_id: 'synthetic-nested', adapter_version: '1.0.0', sourcePayload: 'private',
      } });
    expect(record.details).toEqual({ operation: 'nested-smoke', adapter_id: 'synthetic-nested', adapter_version: '1.0.0' });
    expect(summarizeTrace([record], true, { workflow: false }, true).stages)
      .toContainEqual({ stage: 'adapter', status: 'OK' });
  });

  it('offers nested smoke only through the existing owner-protected manual workflow', () => {
    const workflow = readFileSync(new URL('../.github/workflows/migration-smoke.yml', import.meta.url), 'utf8');
    expect(workflow).toContain('options: [diagnose, smoke, processor-smoke, nested-smoke]');
    const guard = workflow.split('\n').find(line => line.includes("inputs.operation == 'nested-smoke'"));
    expect(guard).toContain("github.ref == 'refs/heads/main'");
    expect(guard).toContain('github.actor == github.repository_owner');
    expect(workflow).toContain('contents: read');
    expect(workflow).toContain('group: mezfit-migration-cloudflare');
    expect(workflow).toContain('path: migration-trace.json');
    expect(workflow).not.toMatch(/^  (?:push|pull_request):/m);
  });
});
