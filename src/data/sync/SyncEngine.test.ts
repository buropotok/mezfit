import { describe, expect, it, vi } from 'vitest';
import type {
  SyncPullResult,
  SyncPushEnvelope,
  SyncPushResult,
} from '../../../shared/sync';
import type { LocalSyncScopeRow, SyncScopeType } from '../local';
import { SyncEngine } from './SyncEngine';
import {
  createSyncScopeRow,
  markSyncScopeDirty,
  recordHydratedSyncScope,
} from './state';
import type {
  SyncScopeAdapter,
  SyncStateStore,
} from './types';
import { SyncTransportError } from './types';

class MemorySyncStateStore implements SyncStateStore {
  readonly rows = new Map<string, LocalSyncScopeRow>();

  async get(scopeKey: string): Promise<LocalSyncScopeRow | null> {
    const row = this.rows.get(scopeKey);
    return row ? { ...row } : null;
  }

  async ensure(
    scopeKey: string,
    scopeType: SyncScopeType,
    now: number,
  ): Promise<LocalSyncScopeRow> {
    const existing = this.rows.get(scopeKey);
    if (existing) {
      if (existing.scopeType !== scopeType) throw new Error('SYNC_SCOPE_TYPE_MISMATCH');
      return { ...existing };
    }
    const created = createSyncScopeRow(scopeKey, scopeType, now, null);
    this.rows.set(scopeKey, created);
    return { ...created };
  }

  async update(
    scopeKey: string,
    updater: (current: LocalSyncScopeRow) => LocalSyncScopeRow,
  ): Promise<LocalSyncScopeRow | null> {
    const row = this.rows.get(scopeKey);
    if (!row) return null;
    const next = updater({ ...row });
    this.rows.set(scopeKey, { ...next });
    return { ...next };
  }

  async listAll(): Promise<LocalSyncScopeRow[]> {
    return [...this.rows.values()].map((row) => ({ ...row }));
  }
}

class FakeScopeTable {
  readonly rows = new Map<string, LocalSyncScopeRow>();

  async get(scopeKey: string): Promise<LocalSyncScopeRow | undefined> {
    const row = this.rows.get(scopeKey);
    return row ? { ...row } : undefined;
  }

  async put(row: LocalSyncScopeRow): Promise<void> {
    this.rows.set(row.scopeKey, { ...row });
  }
}

function scopeRow(
  scopeKey: string,
  overrides: Partial<LocalSyncScopeRow> = {},
): LocalSyncScopeRow {
  return {
    ...createSyncScopeRow(scopeKey, 'program', 1_000, 3),
    localRevision: 1,
    status: 'dirty',
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class FakeAdapter implements SyncScopeAdapter {
  readonly scopeType: SyncScopeType = 'program';
  snapshot: unknown = { value: 1 };
  remote: SyncPullResult = {
    scopeKey: 'program:1',
    serverRevision: 4,
    snapshot: { remote: true },
  };

  readonly buildSnapshot = vi.fn(async () => this.snapshot);
  readonly push = vi.fn(async (_envelope: SyncPushEnvelope): Promise<SyncPushResult> => ({
    kind: 'accepted',
    serverRevision: 4,
  }));
  readonly pull = vi.fn(async (_scopeKey: string): Promise<SyncPullResult> => this.remote);
  readonly applyRemoteSnapshotIfClean = vi.fn(async () => true);
}

describe('markSyncScopeDirty', () => {
  it('increments the local revision and preserves an in-flight request', async () => {
    const table = new FakeScopeTable();
    table.rows.set('program:1', scopeRow('program:1', {
      status: 'syncing',
      inflightRequestId: 'request-1',
      inflightRevision: 1,
      inflightSnapshotJson: '{"value":1}',
    }));

    const next = await markSyncScopeDirty(table, 'program:1', 'program', { now: 2_000 });

    expect(next.localRevision).toBe(2);
    expect(next.status).toBe('syncing');
    expect(next.inflightRequestId).toBe('request-1');
    expect(next.inflightSnapshotJson).toBe('{"value":1}');
  });

  it('does not invent a server revision before the scope has been hydrated', async () => {
    const table = new FakeScopeTable();

    const next = await markSyncScopeDirty(table, 'program:new', 'program');

    expect(next.serverRevision).toBeNull();
    expect(next.status).toBe('dirty');
  });

  it('records the hydrated server baseline without discarding a pre-hydration local edit', async () => {
    const table = new FakeScopeTable();
    await markSyncScopeDirty(table, 'program:new', 'program', { now: 1_000 });

    const hydrated = await recordHydratedSyncScope(
      table,
      'program:new',
      'program',
      7,
      2_000,
    );

    expect(hydrated).toMatchObject({
      localRevision: 1,
      serverRevision: 7,
      status: 'dirty',
      remoteChanged: false,
      remoteChangeCounter: 0,
    });
  });

  it('releases a manual-only retry when late hydration supplies the first server baseline', async () => {
    const table = new FakeScopeTable();
    table.rows.set('program:new', scopeRow('program:new', {
      serverRevision: null,
      status: 'retry_wait',
      attemptCount: 1,
      nextRetryAt: null,
      lastError: 'SYNC_SERVER_REVISION_UNKNOWN',
      inflightRequestId: null,
      inflightRevision: null,
      inflightSnapshotJson: null,
    }));

    const hydrated = await recordHydratedSyncScope(
      table,
      'program:new',
      'program',
      7,
      2_000,
    );

    expect(hydrated).toMatchObject({
      serverRevision: 7,
      status: 'dirty',
      attemptCount: 0,
      nextRetryAt: null,
      lastError: null,
    });
  });
});

describe('SyncEngine', () => {
  it('marks a successfully accepted snapshot clean', async () => {
    const store = new MemorySyncStateStore();
    store.rows.set('program:1', scopeRow('program:1'));
    const adapter = new FakeAdapter();
    const engine = new SyncEngine(store, [adapter], {
      createRequestId: () => 'request-0001',
      now: () => 2_000,
    });

    await expect(engine.flush('program:1')).resolves.toEqual({
      kind: 'accepted',
      serverRevision: 4,
      newerLocalChanges: false,
    });

    expect(adapter.push).toHaveBeenCalledWith({
      requestId: 'request-0001',
      scopeKey: 'program:1',
      baseServerRevision: 3,
      snapshot: { value: 1 },
    });
    expect(store.rows.get('program:1')).toMatchObject({
      serverRevision: 4,
      status: 'clean',
      attemptCount: 0,
      inflightRequestId: null,
      inflightRevision: null,
      inflightSnapshotJson: null,
    });
  });

  it('retries a lost response with the same request id and the same persisted snapshot', async () => {
    let now = 1_000;
    const store = new MemorySyncStateStore();
    store.rows.set('program:1', scopeRow('program:1'));
    const adapter = new FakeAdapter();
    adapter.push
      .mockRejectedValueOnce(new SyncTransportError('offline', true, 'OFFLINE'))
      .mockResolvedValueOnce({ kind: 'accepted', serverRevision: 4 });
    const engine = new SyncEngine(store, [adapter], {
      createRequestId: () => 'request-0001',
      now: () => now,
      retryBaseMs: 100,
    });

    await expect(engine.flush('program:1')).resolves.toEqual({
      kind: 'retry_wait',
      nextRetryAt: 1_100,
      attemptCount: 1,
    });
    const afterFailure = store.rows.get('program:1');
    expect(afterFailure).toMatchObject({
      status: 'retry_wait',
      inflightRequestId: 'request-0001',
      inflightSnapshotJson: '{"value":1}',
    });

    adapter.snapshot = { value: 999 };
    now = 1_100;
    await engine.flush('program:1');

    expect(adapter.buildSnapshot).toHaveBeenCalledTimes(1);
    expect(adapter.push).toHaveBeenNthCalledWith(2, {
      requestId: 'request-0001',
      scopeKey: 'program:1',
      baseServerRevision: 3,
      snapshot: { value: 1 },
    });
  });

  it('sends a newer local revision only after the older in-flight snapshot is acknowledged', async () => {
    const first = deferred<SyncPushResult>();
    const store = new MemorySyncStateStore();
    store.rows.set('program:1', scopeRow('program:1'));
    const adapter = new FakeAdapter();
    adapter.push
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ kind: 'accepted', serverRevision: 5 });
    let requestNumber = 0;
    const engine = new SyncEngine(store, [adapter], {
      createRequestId: () => `request-000${++requestNumber}`,
      now: () => 2_000,
    });

    const firstFlush = engine.flush('program:1');
    await vi.waitFor(() => expect(adapter.push).toHaveBeenCalledTimes(1));

    const current = store.rows.get('program:1');
    if (!current) throw new Error('missing scope');
    store.rows.set('program:1', {
      ...current,
      localRevision: 2,
    });
    adapter.snapshot = { value: 2 };

    first.resolve({ kind: 'accepted', serverRevision: 4 });
    await expect(firstFlush).resolves.toEqual({
      kind: 'accepted',
      serverRevision: 4,
      newerLocalChanges: true,
    });
    expect(store.rows.get('program:1')?.status).toBe('dirty');

    await engine.flush('program:1');
    expect(adapter.push).toHaveBeenNthCalledWith(2, {
      requestId: 'request-0002',
      scopeKey: 'program:1',
      baseServerRevision: 4,
      snapshot: { value: 2 },
    });
  });

  it('automatically sends a newer local correction after the older inflight snapshot is definitively rejected', async () => {
    const first = deferred<SyncPushResult>();
    const store = new MemorySyncStateStore();
    store.rows.set('program:1', scopeRow('program:1'));
    const adapter = new FakeAdapter();
    adapter.push
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ kind: 'accepted', serverRevision: 4 });
    let requestNumber = 0;
    const engine = new SyncEngine(store, [adapter], {
      createRequestId: () => `request-000${++requestNumber}`,
      now: () => 2_000,
    });

    const firstFlush = engine.flush('program:1');
    await vi.waitFor(() => expect(adapter.push).toHaveBeenCalledTimes(1));

    const current = store.rows.get('program:1');
    if (!current) throw new Error('missing scope');
    store.rows.set('program:1', {
      ...current,
      localRevision: 2,
    });
    adapter.snapshot = { value: 2 };

    first.reject(new SyncTransportError('invalid', false, 'VALIDATION_REJECTED'));
    await expect(firstFlush).resolves.toEqual({
      kind: 'retry_wait',
      nextRetryAt: null,
      attemptCount: 0,
    });
    expect(store.rows.get('program:1')).toMatchObject({
      status: 'dirty',
      inflightRequestId: null,
      inflightRevision: null,
      inflightSnapshotJson: null,
      lastError: 'VALIDATION_REJECTED',
    });

    await engine.flush('program:1');

    expect(adapter.push).toHaveBeenNthCalledWith(2, {
      requestId: 'request-0002',
      scopeKey: 'program:1',
      baseServerRevision: 3,
      snapshot: { value: 2 },
    });
  });

  it('drops a definitively rejected inflight snapshot so a corrected edit can build a new request', async () => {
    const store = new MemorySyncStateStore();
    store.rows.set('program:1', scopeRow('program:1'));
    const adapter = new FakeAdapter();
    adapter.push
      .mockRejectedValueOnce(new SyncTransportError('invalid', false, 'VALIDATION_REJECTED'))
      .mockResolvedValueOnce({ kind: 'accepted', serverRevision: 4 });
    let requestNumber = 0;
    const engine = new SyncEngine(store, [adapter], {
      createRequestId: () => `request-000${++requestNumber}`,
      now: () => 2_000,
    });

    await expect(engine.flush('program:1')).resolves.toEqual({
      kind: 'retry_wait',
      nextRetryAt: null,
      attemptCount: 1,
    });
    expect(store.rows.get('program:1')).toMatchObject({
      status: 'retry_wait',
      inflightRequestId: null,
      inflightRevision: null,
      inflightSnapshotJson: null,
      lastError: 'VALIDATION_REJECTED',
    });

    const rejected = store.rows.get('program:1');
    if (!rejected) throw new Error('missing scope');
    store.rows.set('program:1', {
      ...rejected,
      localRevision: rejected.localRevision + 1,
      status: 'dirty',
      attemptCount: 0,
      lastError: null,
    });
    adapter.snapshot = { value: 2 };

    await engine.flush('program:1', { force: true });

    expect(adapter.buildSnapshot).toHaveBeenCalledTimes(2);
    expect(adapter.push).toHaveBeenNthCalledWith(2, {
      requestId: 'request-0002',
      scopeKey: 'program:1',
      baseServerRevision: 3,
      snapshot: { value: 2 },
    });
  });

  it('stops automatic retries after the configured limit but manual sync restarts them', async () => {
    let now = 1_000;
    const store = new MemorySyncStateStore();
    store.rows.set('program:1', scopeRow('program:1'));
    const adapter = new FakeAdapter();
    adapter.push.mockRejectedValue(new SyncTransportError('offline', true, 'OFFLINE'));
    const engine = new SyncEngine(store, [adapter], {
      createRequestId: () => 'request-0001',
      now: () => now,
      retryBaseMs: 100,
      maxAutomaticAttempts: 2,
    });

    await engine.flush('program:1');
    now = 1_100;
    await expect(engine.flush('program:1')).resolves.toEqual({
      kind: 'retry_wait',
      nextRetryAt: null,
      attemptCount: 2,
    });
    await expect(engine.flush('program:1')).resolves.toEqual({
      kind: 'skipped',
      reason: 'manual_only',
    });

    await expect(engine.flush('program:1', { force: true })).resolves.toEqual({
      kind: 'retry_wait',
      nextRetryAt: 1_200,
      attemptCount: 1,
    });
    expect(adapter.push).toHaveBeenLastCalledWith(expect.objectContaining({
      requestId: 'request-0001',
      snapshot: { value: 1 },
    }));
  });

  it('moves a revision mismatch into conflict without sending a newer snapshot', async () => {
    const store = new MemorySyncStateStore();
    store.rows.set('program:1', scopeRow('program:1'));
    const adapter = new FakeAdapter();
    adapter.push.mockResolvedValue({ kind: 'conflict', serverRevision: 8 });
    const engine = new SyncEngine(store, [adapter], {
      createRequestId: () => 'request-0001',
    });

    await expect(engine.flush('program:1')).resolves.toEqual({
      kind: 'conflict',
      serverRevision: 8,
    });
    expect(store.rows.get('program:1')).toMatchObject({
      status: 'conflict',
      serverRevision: 8,
      remoteChanged: true,
      inflightRequestId: null,
    });
  });

  it('recovers after restart by retrying the persisted in-flight request', async () => {
    const store = new MemorySyncStateStore();
    store.rows.set('program:1', scopeRow('program:1', {
      status: 'syncing',
      inflightRequestId: 'request-old',
      inflightRevision: 1,
      inflightSnapshotJson: '{"value":"old"}',
    }));
    const adapter = new FakeAdapter();
    const engine = new SyncEngine(store, [adapter], {
      createRequestId: () => 'request-new',
    });

    await engine.flush('program:1');

    expect(adapter.buildSnapshot).not.toHaveBeenCalled();
    expect(adapter.push).toHaveBeenCalledWith({
      requestId: 'request-old',
      scopeKey: 'program:1',
      baseServerRevision: 3,
      snapshot: { value: 'old' },
    });
  });

  it('creates a missing local scope when a remote change arrives first', async () => {
    const store = new MemorySyncStateStore();
    const adapter = new FakeAdapter();
    adapter.remote = {
      scopeKey: 'program:new',
      serverRevision: 1,
      snapshot: { remote: 'new' },
    };
    const engine = new SyncEngine(store, [adapter], { now: () => 2_000 });

    await engine.notifyRemoteChange('program:new', 'program');
    await expect(engine.refresh('program:new')).resolves.toEqual({
      kind: 'applied',
      serverRevision: 1,
    });

    expect(store.rows.get('program:new')).toMatchObject({
      scopeType: 'program',
      serverRevision: 1,
      status: 'clean',
      remoteChanged: false,
    });
  });

  it('defers an incoming server snapshot while local data is dirty', async () => {
    const store = new MemorySyncStateStore();
    store.rows.set('program:1', scopeRow('program:1'));
    const adapter = new FakeAdapter();
    const engine = new SyncEngine(store, [adapter]);

    await engine.notifyRemoteChange('program:1', 'program');
    await expect(engine.refresh('program:1')).resolves.toEqual({ kind: 'deferred' });

    expect(adapter.pull).not.toHaveBeenCalled();
    expect(store.rows.get('program:1')?.remoteChanged).toBe(true);
  });

  it('does not clear a newer remote notification that arrives during a pull', async () => {
    const pull = deferred<SyncPullResult>();
    const store = new MemorySyncStateStore();
    store.rows.set('program:1', scopeRow('program:1', {
      status: 'clean',
      localRevision: 0,
      remoteChanged: true,
      remoteChangeCounter: 1,
    }));
    const adapter = new FakeAdapter();
    adapter.pull.mockImplementationOnce(() => pull.promise);
    const engine = new SyncEngine(store, [adapter]);

    const refresh = engine.refresh('program:1');
    await vi.waitFor(() => expect(adapter.pull).toHaveBeenCalledTimes(1));
    await engine.notifyRemoteChange('program:1', 'program');
    pull.resolve({
      scopeKey: 'program:1',
      serverRevision: 4,
      snapshot: { remote: 4 },
    });

    await expect(refresh).resolves.toEqual({ kind: 'applied', serverRevision: 4 });
    expect(store.rows.get('program:1')).toMatchObject({
      serverRevision: 4,
      remoteChanged: true,
      remoteChangeCounter: 2,
    });
  });

  it('isolates a failed scope from unrelated scopes during flushAll', async () => {
    const store = new MemorySyncStateStore();
    store.rows.set('program:1', scopeRow('program:1'));
    store.rows.set('program:2', scopeRow('program:2'));
    const adapter = new FakeAdapter();
    adapter.push.mockImplementation(async (envelope) => {
      if (envelope.scopeKey === 'program:1') {
        throw new SyncTransportError('offline', true, 'OFFLINE');
      }
      return { kind: 'accepted', serverRevision: 4 };
    });
    let id = 0;
    const engine = new SyncEngine(store, [adapter], {
      createRequestId: () => `request-000${++id}`,
      now: () => 1_000,
    });

    const results = await engine.flushAll();

    expect(results.get('program:1')).toMatchObject({ kind: 'retry_wait' });
    expect(results.get('program:2')).toEqual({
      kind: 'accepted',
      serverRevision: 4,
      newerLocalChanges: false,
    });
    expect(store.rows.get('program:2')?.status).toBe('clean');
  });
});
