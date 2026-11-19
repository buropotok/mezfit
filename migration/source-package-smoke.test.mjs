import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { runProcessorSmoke } from './processor-control.mjs';
import { sanitizeTrace } from './trace.mjs';

const id = '4fe7581a-62c8-407d-bae6-6ddfe8067036';
const version = 'c89a8a4d-18c9-4eb5-9dfa-af79cfc455ef';
function controller({ marker = 'MIGRATION_SOURCE_PACKAGE_SMOKE_VERIFIED', cleanup = 'MIGRATION_PROCESSOR_CLEANUP_OK',
  smokeStatus = 'complete', stale = false, loseReply = false } = {}) {
  const instances = new Map(), params = [], emit = vi.fn();
  const api = {
    request: vi.fn(async (_path, { body }) => {
      params.push(body.params);
      const op = body.params.operation;
      instances.set(body.instance_id, op === 'processor-ready'
        ? { status: 'complete', output: 'MIGRATION_PROCESSOR_READY:' + (stale ? id : version) }
        : op === 'processor-source-package-smoke' ? { status: smokeStatus, output: marker }
          : { status: 'complete', output: cleanup });
      if (loseReply && op === 'processor-source-package-smoke') {
        loseReply = false; throw Object.assign(new Error('private provider response'), { transient: true });
      }
    }),
    get: vi.fn(async path => instances.get(path.split('/').at(-1))),
  };
  return { api, params, emit, run: () => runProcessorSmoke(api, id, version, emit, {},
    { operation: 'source-package-smoke', wait: async () => {}, runId: '123' }) };
}

describe('independent source-package cloud operation', () => {
  it('requires readiness, the new marker and confirmed shared cleanup after an ambiguous dispatch', async () => {
    const job = controller({ loseReply: true });
    await expect(job.run()).resolves.toBe('MIGRATION_SOURCE_PACKAGE_SMOKE_OK');
    expect(job.params.map(row => row.operation)).toEqual(['processor-ready', 'processor-source-package-smoke', 'processor-cleanup']);
    expect(job.params[1]).toMatchObject({ jobId: id, expectedVersion: version, runId: '123' });
    expect(job.params[2].targetId).toBe(id);
  });
  it.each(['MIGRATION_PROCESSOR_SMOKE_VERIFIED', 'MIGRATION_NESTED_SMOKE_VERIFIED', null])('refuses legacy or absent verification %s', async marker => {
    await expect(controller({ marker }).run()).rejects.toThrow('MIGRATION_PROCESSOR_SMOKE_FAILED');
  });
  it('refuses unconfirmed cleanup and preserves a primary smoke error', async () => {
    await expect(controller({ cleanup: 'incomplete' }).run()).rejects.toThrow('PROCESSOR_SMOKE_CLEANUP_FAILED');
    const job = controller({ marker: 'invalid', cleanup: 'incomplete' });
    await expect(job.run()).rejects.toThrow('MIGRATION_PROCESSOR_SMOKE_FAILED');
    expect(job.emit).toHaveBeenCalledWith('cleanup', 'processor-smoke-cleanup', 'PROCESSOR_CLEANUP_CONTROL', 'FAILED',
      expect.objectContaining({ error_code: 'PROCESSOR_SMOKE_CLEANUP_FAILED' }));
  });
  it('does not upload after repeated deployed-version mismatch', async () => {
    const job = controller({ stale: true });
    await expect(job.run()).rejects.toThrow('DEPLOYED_VERSION_NOT_READY');
    expect(job.params.map(row => row.operation)).toEqual(Array(5).fill('processor-ready'));
  });
  it('allows operation/adapter evidence and drops package fields from trace', () => {
    const value = sanitizeTrace({ timestamp: '2026-11-19T00:00:00.000Z', trace_id: id,
      component: 'processor', stage: 'adapter-selection', event: 'ADAPTER_SELECTED', status: 'OK', details: {
        operation: 'source-package-smoke', adapter_id: 'synthetic-training', adapter_version: '1.0.0',
        sourceKey: 'private-person', displayName: 'Private Person', sourcePackage: { raw: 'private' },
      } });
    expect(value.details).toEqual({ operation: 'source-package-smoke', adapter_id: 'synthetic-training', adapter_version: '1.0.0' });
  });
  it('extends the serialized main-only chain and owner-protected diagnostic workflow', () => {
    const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
    const auto = read('../.github/workflows/migration-auto.yml');
    expect(auto).toMatch(/processor-smoke:\s+needs: deploy/);
    expect(auto).toMatch(/nested-smoke:\s+needs: processor-smoke/);
    expect(auto).toMatch(/source-package-smoke:\s+needs: nested-smoke/);
    const job = auto.slice(auto.indexOf('  source-package-smoke:'));
    expect(job).toContain('MIGRATION_OPERATION: source-package-smoke');
    expect(job).toContain('path: migration-trace.json');
    expect(job).not.toMatch(/npm |typecheck|npm test|build/);
    expect(auto).not.toContain('pull_request:');
    expect(auto).toContain('group: mezfit-migration-cloudflare');
    const manual = read('../.github/workflows/migration-smoke.yml');
    expect(manual).toContain('source-package-smoke]');
    const guard = manual.split('\n').find(line => line.includes("inputs.operation == 'source-package-smoke'"));
    expect(guard).toContain("github.ref == 'refs/heads/main'");
    expect(guard).toContain('github.actor == github.repository_owner');
    // Every runner gate must recognize the new scenario, including final trace.
    const runner = read('./cloudflare.mjs');
    expect(runner.match(/'processor-smoke', 'nested-smoke', 'source-package-smoke'/g)).toHaveLength(4);
    expect(runner).toContain("operation === 'source-package-smoke' ? 'synthetic-training'");
  });
});
