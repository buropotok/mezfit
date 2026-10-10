import { describe, expect, it, vi } from 'vitest';
import type { SyncEngine } from './SyncEngine';
import { SyncWorker, SyncWorkerScopeError } from './SyncWorker';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('SyncWorker', () => {
  it('preserves a forced manual wake requested during an active background pass', async () => {
    const first = deferred<Map<string, never>>();
    const flushAll = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(new Map());
    const engine = { flushAll } as unknown as SyncEngine;
    const worker = new SyncWorker(engine, { intervalMs: 60_000 });

    worker.start();
    await vi.waitFor(() => expect(flushAll).toHaveBeenCalledTimes(1));

    const manualWake = worker.wake({ force: true });
    first.resolve(new Map<string, never>());
    await manualWake;

    expect(flushAll).toHaveBeenCalledTimes(2);
    expect(flushAll).toHaveBeenNthCalledWith(1, { force: false });
    expect(flushAll).toHaveBeenNthCalledWith(2, { force: true });

    worker.stop();
  });

  it('does not lose a forced wake queued as the active pass is settling', async () => {
    const first = deferred<Map<string, never>>();
    const flushAll = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(new Map());
    const engine = { flushAll } as unknown as SyncEngine;
    const worker = new SyncWorker(engine, { intervalMs: 60_000 });

    worker.start();
    await vi.waitFor(() => expect(flushAll).toHaveBeenCalledTimes(1));

    first.resolve(new Map<string, never>());
    await first.promise;
    await worker.wake({ force: true });

    expect(flushAll).toHaveBeenCalledTimes(2);
    expect(flushAll).toHaveBeenNthCalledWith(2, { force: true });
    worker.stop();
  });

  it('cancels queued automatic reruns after stop but preserves explicit forced wakes', async () => {
    const first = deferred<Map<string, never>>();
    const flushAll = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(new Map());
    const engine = { flushAll } as unknown as SyncEngine;
    const worker = new SyncWorker(engine, { intervalMs: 60_000 });

    worker.start();
    await vi.waitFor(() => expect(flushAll).toHaveBeenCalledTimes(1));

    const queuedAutomaticWake = worker.wake();
    worker.stop();
    first.resolve(new Map<string, never>());
    await first.promise;
    await queuedAutomaticWake;

    expect(flushAll).toHaveBeenCalledTimes(1);

    await worker.wake({ force: true });
    expect(flushAll).toHaveBeenCalledTimes(2);
    expect(flushAll).toHaveBeenNthCalledWith(2, { force: true });
  });

  it('reports isolated scope failures without aborting the worker pass', async () => {
    const failureResults = new Map([
      ['program:1', { kind: 'failed' as const, error: 'SYNC_ADAPTER_MISSING:program' }],
      ['program:2', { kind: 'clean' as const }],
    ]);
    const flushAll = vi.fn().mockResolvedValue(failureResults);
    const onError = vi.fn();
    const engine = { flushAll } as unknown as SyncEngine;
    const worker = new SyncWorker(engine, { intervalMs: 60_000, onError });

    worker.start();

    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    const [error] = onError.mock.calls[0] as [unknown];
    expect(error).toBeInstanceOf(SyncWorkerScopeError);
    expect(error).toMatchObject({
      scopeKey: 'program:1',
      code: 'SYNC_ADAPTER_MISSING:program',
    });
    expect(flushAll).toHaveBeenCalledTimes(1);
    worker.stop();
  });

  it('contains fire-and-forget wake failures at the worker boundary', async () => {
    const failure = new Error('indexeddb unavailable');
    const flushAll = vi.fn().mockRejectedValue(failure);
    const onError = vi.fn();
    const engine = { flushAll } as unknown as SyncEngine;
    const worker = new SyncWorker(engine, { intervalMs: 60_000, onError });

    worker.start();

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
    worker.stop();
  });

  it('start and stop are idempotent', async () => {
    const flushAll = vi.fn().mockResolvedValue(new Map());
    const engine = { flushAll } as unknown as SyncEngine;
    const worker = new SyncWorker(engine, { intervalMs: 60_000 });

    worker.start();
    worker.start();
    await vi.waitFor(() => expect(flushAll).toHaveBeenCalledTimes(1));

    worker.stop();
    worker.stop();
  });
});
