import { describe, expect, it, vi } from 'vitest';
import { diagnoseSmoke, runSmoke } from './smoke-control.mjs';

const id = 'a9292ed7-b383-45ad-aa27-665cd70f91a2';
const path = '/workflows/mezfit-migration-workflow/instances';
const wait = async () => {};

describe('migration Workflow management API', () => {
  it('passes structured params as Wrangler does and verifies completion', async () => {
    const api = { request: vi.fn(), get: vi.fn()
      .mockResolvedValueOnce({ status: 'queued' })
      .mockResolvedValueOnce({ status: 'complete', output: '"MIGRATION_SMOKE_OK"' }) };
    const report = vi.fn();
    await runSmoke(api, report, { id, wait });
    expect(api.request).toHaveBeenCalledExactlyOnceWith(path, {
      method: 'POST', body: { instance_id: id, params: { operation: 'smoke' } },
    });
    expect(api.get).toHaveBeenCalledWith(path + '/' + id);
    expect(report.mock.calls[0][0]).toEqual(expect.arrayContaining(['Migration Smoke: PASSED', 'MIGRATION_SMOKE_OK']));
  });

  it('reads an existing instance and shows the real failed attempt with sanitized data', async () => {
    const secret = 'do-not-log-this-token';
    const api = { request: vi.fn(), get: vi.fn(async () => ({
      status: 'errored', params: { secret },
      error: { name: 'Error', message: 'Workflow execution failed' },
      steps: [{
        name: 'Upload signed R2 backup', type: 'step', success: false,
        attempts: [
          { success: false, error: { name: 'TypeError', message: 'Network error https://s3.test/?X-Amz-Signature=' + secret } },
          { success: false, error: { name: 'NonRetryableError',
            message: 'SMOKE_SIGNED_PUT_FAILED|authentication|http-200|http-403-SignatureDoesNotMatch' } },
        ],
      }],
    })) };
    const report = vi.fn();
    await diagnoseSmoke(api, id, report);
    expect(api.request).not.toHaveBeenCalled();
    expect(api.get).toHaveBeenCalledExactlyOnceWith(path + '/' + id);
    const lines = report.mock.calls[0][0];
    expect(lines).toEqual(expect.arrayContaining([
      'Migration Smoke: FAILED', 'Failed step: Upload signed R2 backup', 'Attempt: 2',
      'Error category: authentication', 'Error code: SMOKE_SIGNED_PUT_FAILED',
      'Expected: http-200', 'Actual: http-403-SignatureDoesNotMatch',
    ]));
    expect(lines.join('\n')).toContain('WORKFLOW_TYPEERROR');
    expect(lines.join('\n')).not.toContain(secret);
    expect(lines.join('\n')).not.toContain('X-Amz-Signature');
  });

  it('does not submit a second smoke when the create response is lost', async () => {
    const api = { request: vi.fn().mockRejectedValueOnce(Object.assign(new Error('lost response'), { transient: true })),
      get: vi.fn().mockResolvedValue({ status: 'complete', output: 'MIGRATION_SMOKE_OK' }) };
    await runSmoke(api, vi.fn(), { id, wait });
    expect(api.request).toHaveBeenCalledOnce();
    expect(api.get).toHaveBeenCalledExactlyOnceWith(path + '/' + id);
  });

  it('backs off an explicit rate limit and resubmits the same instance ID', async () => {
    const api = { request: vi.fn().mockRejectedValueOnce(Object.assign(new Error('rate limited'), { status: 429, transient: true })),
      get: vi.fn().mockResolvedValue({ status: 'complete', output: 'MIGRATION_SMOKE_OK' }) };
    const pause = vi.fn();
    await runSmoke(api, vi.fn(), { id, wait: pause });
    expect(pause).toHaveBeenCalledExactlyOnceWith(2000);
    expect(api.request).toHaveBeenCalledTimes(2);
    expect(api.request.mock.calls[0]).toEqual(api.request.mock.calls[1]);
  });

  it('queues cleanup for a failed smoke and keeps the original error report', async () => {
    const api = { request: vi.fn(), get: vi.fn().mockResolvedValue({
      status: 'errored', error: { name: 'ReferenceError', message: 'arbitrary private data' },
    }) };
    const report = vi.fn();
    await expect(runSmoke(api, report, { id, wait })).rejects.toThrow('MIGRATION_SMOKE_ERRORED');
    expect(api.request.mock.calls[1][1].body.params).toEqual({ operation: 'cleanup', targetId: id });
    const output = report.mock.calls[0][0].join('\n');
    expect(output).toContain('WORKFLOW_REFERENCEERROR');
    expect(output).toContain('message fingerprint');
    expect(output).not.toContain('arbitrary private data');
  });

  it('finishes polling within its bound without deleting objects of a running instance', async () => {
    const api = { request: vi.fn(), get: vi.fn().mockResolvedValue({ status: 'waiting' }) };
    const report = vi.fn();
    await expect(runSmoke(api, report, { id, wait, maxPolls: 2 })).rejects.toThrow('MIGRATION_SMOKE_TIMEOUT');
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(api.request).toHaveBeenCalledOnce();
  });
});
