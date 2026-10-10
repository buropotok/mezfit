import { describe, expect, it, vi } from 'vitest';
import type { SyncEngine } from './SyncEngine';
import { SyncWorker } from './SyncWorker';

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
    first.resolve(new Map());
    await manualWake;

    expect(flushAll).toHaveBeenCalledTimes(2);
    expect(flushAll).toHaveBeenNthCalledWith(1, { force: false });
    expect(flushAll).toHaveBeenNthCalledWith(2, { force: true });

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
