import type {
  SyncPushEnvelope,
  SyncPullResult,
} from '../../../shared/sync';
import type { LocalSyncScopeRow, SyncScopeType } from '../local';
import type {
  SyncFlushOutcome,
  SyncPullOutcome,
  SyncScopeAdapter,
  SyncStateStore,
} from './types';
import { SyncTransportError } from './types';

export interface SyncEngineOptions {
  now?: () => number;
  createRequestId?: () => string;
  maxAutomaticAttempts?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  concurrency?: number;
}

function defaultRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  throw new Error('SYNC_RANDOM_UUID_UNAVAILABLE');
}

function serializeSnapshot(snapshot: unknown): string {
  const json = JSON.stringify(snapshot);
  if (json === undefined) throw new Error('SYNC_SNAPSHOT_NOT_SERIALIZABLE');
  return json;
}

function parseSnapshot(json: string): unknown {
  return JSON.parse(json) as unknown;
}

function errorCode(error: unknown): string {
  if (error instanceof SyncTransportError) return error.code;
  if (error instanceof Error && error.message) return error.message;
  return 'SYNC_UNKNOWN_ERROR';
}

export class SyncEngine {
  private readonly adapters = new Map<SyncScopeType, SyncScopeAdapter>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly now: () => number;
  private readonly createRequestId: () => string;
  private readonly maxAutomaticAttempts: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly concurrency: number;

  constructor(
    private readonly store: SyncStateStore,
    adapters: readonly SyncScopeAdapter[],
    options: SyncEngineOptions = {},
  ) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.scopeType)) {
        throw new Error(`SYNC_ADAPTER_DUPLICATE:${adapter.scopeType}`);
      }
      this.adapters.set(adapter.scopeType, adapter);
    }
    this.now = options.now ?? Date.now;
    this.createRequestId = options.createRequestId ?? defaultRequestId;
    this.maxAutomaticAttempts = Math.max(1, options.maxAutomaticAttempts ?? 5);
    this.retryBaseMs = Math.max(100, options.retryBaseMs ?? 2_000);
    this.retryMaxMs = Math.max(this.retryBaseMs, options.retryMaxMs ?? 60_000);
    this.concurrency = Math.max(1, options.concurrency ?? 3);
  }

  async flush(scopeKey: string, options: { force?: boolean } = {}): Promise<SyncFlushOutcome> {
    return this.withScopeLock(scopeKey, () => this.flushUnlocked(scopeKey, Boolean(options.force)));
  }

  async refresh(scopeKey: string): Promise<SyncPullOutcome> {
    return this.withScopeLock(scopeKey, () => this.pullUnlocked(scopeKey));
  }

  async notifyRemoteChange(scopeKey: string, scopeType: SyncScopeType): Promise<void> {
    await this.store.ensure(scopeKey, scopeType, this.now());
    await this.store.update(scopeKey, (current) => ({
      ...current,
      remoteChanged: true,
      remoteChangeCounter: current.remoteChangeCounter + 1,
      updatedAt: this.now(),
    }));
  }

  async resumeAfterConflict(scopeKey: string, serverRevision: number): Promise<void> {
    if (!Number.isInteger(serverRevision) || serverRevision < 0) {
      throw new Error('SYNC_SERVER_REVISION_INVALID');
    }
    await this.store.update(scopeKey, (current) => ({
      ...current,
      serverRevision,
      status: 'dirty',
      attemptCount: 0,
      nextRetryAt: null,
      lastError: null,
      inflightRequestId: null,
      inflightRevision: null,
      inflightSnapshotJson: null,
      remoteChanged: false,
      updatedAt: this.now(),
    }));
  }

  async flushAll(options: { force?: boolean } = {}): Promise<Map<string, SyncFlushOutcome | SyncPullOutcome>> {
    const rows = await this.store.listAll();
    const force = Boolean(options.force);
    const now = this.now();
    const candidates = rows.filter((row) => {
      if (row.status === 'conflict') return false;
      if (row.remoteChanged && row.status === 'clean') return true;
      if (row.status === 'dirty' || row.status === 'syncing') return true;
      if (row.status !== 'retry_wait') return false;
      if (force) return true;
      return row.nextRetryAt !== null && row.nextRetryAt <= now;
    });

    const results = new Map<string, SyncFlushOutcome | SyncPullOutcome>();
    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(this.concurrency, candidates.length) },
      async () => {
        while (cursor < candidates.length) {
          const row = candidates[cursor];
          cursor += 1;
          try {
            const result = row.remoteChanged && row.status === 'clean'
              ? await this.refresh(row.scopeKey)
              : await this.flush(row.scopeKey, { force });
            results.set(row.scopeKey, result);
          } catch (error) {
            results.set(row.scopeKey, {
              kind: 'failed',
              error: errorCode(error),
            });
          }
        }
      },
    );
    await Promise.all(workers);
    return results;
  }

  private async flushUnlocked(scopeKey: string, force: boolean): Promise<SyncFlushOutcome> {
    let row = await this.store.get(scopeKey);
    if (!row) return { kind: 'skipped', reason: 'missing_scope' };

    if (row.status === 'clean') {
      if (row.remoteChanged) {
        await this.pullUnlocked(scopeKey);
      }
      return { kind: 'clean' };
    }
    if (row.status === 'conflict') return { kind: 'skipped', reason: 'conflict' };

    if (row.status === 'retry_wait' && !force) {
      if (row.nextRetryAt === null) return { kind: 'skipped', reason: 'manual_only' };
      if (row.nextRetryAt > this.now()) return { kind: 'skipped', reason: 'not_due' };
    }

    if (row.serverRevision === null) {
      await this.store.update(scopeKey, (current) => ({
        ...current,
        status: 'retry_wait',
        nextRetryAt: null,
        lastError: 'SYNC_SERVER_REVISION_UNKNOWN',
        updatedAt: this.now(),
      }));
      return { kind: 'skipped', reason: 'server_revision_unknown' };
    }

    const adapter = this.adapterFor(row.scopeType);
    const prepared = await this.prepareInflight(row, adapter, force);
    if (!prepared) return { kind: 'skipped', reason: 'changed_during_snapshot' };
    row = prepared.row;

    const envelope: SyncPushEnvelope = {
      requestId: prepared.requestId,
      scopeKey,
      baseServerRevision: row.serverRevision,
      snapshot: prepared.snapshot,
    };

    try {
      const result = await adapter.push(envelope);
      if (result.kind === 'conflict') {
        await this.store.update(scopeKey, (current) => {
          if (current.inflightRequestId !== prepared.requestId) return current;
          return {
            ...current,
            serverRevision: result.serverRevision,
            status: 'conflict',
            attemptCount: 0,
            nextRetryAt: null,
            lastError: 'SYNC_CONFLICT',
            inflightRequestId: null,
            inflightRevision: null,
            inflightSnapshotJson: null,
            remoteChanged: true,
            updatedAt: this.now(),
          };
        });
        return { kind: 'conflict', serverRevision: result.serverRevision };
      }

      let newerLocalChanges = false;
      let shouldPull = false;
      await this.store.update(scopeKey, (current) => {
        if (current.inflightRequestId !== prepared.requestId) return current;
        newerLocalChanges = current.localRevision > prepared.inflightRevision;
        shouldPull = !newerLocalChanges && current.remoteChanged;
        return {
          ...current,
          serverRevision: result.serverRevision,
          status: newerLocalChanges ? 'dirty' : 'clean',
          attemptCount: 0,
          nextRetryAt: null,
          lastError: null,
          inflightRequestId: null,
          inflightRevision: null,
          inflightSnapshotJson: null,
          updatedAt: this.now(),
        };
      });

      if (shouldPull) await this.pullUnlocked(scopeKey);
      return {
        kind: 'accepted',
        serverRevision: result.serverRevision,
        newerLocalChanges,
      };
    } catch (error) {
      const retryable = !(error instanceof SyncTransportError) || error.retryable;
      let nextRetryAt: number | null = null;
      let attemptCount = 0;
      await this.store.update(scopeKey, (current) => {
        if (current.inflightRequestId !== prepared.requestId) return current;
        const previousAttempts = force ? 0 : current.attemptCount;
        attemptCount = previousAttempts + 1;
        const canRetryAutomatically = retryable
          && attemptCount < this.maxAutomaticAttempts;
        nextRetryAt = canRetryAutomatically
          ? this.now() + this.retryDelay(attemptCount)
          : null;
        return {
          ...current,
          status: 'retry_wait',
          attemptCount,
          nextRetryAt,
          lastError: errorCode(error),
          updatedAt: this.now(),
        };
      });
      return { kind: 'retry_wait', nextRetryAt, attemptCount };
    }
  }

  private async prepareInflight(
    initial: LocalSyncScopeRow,
    adapter: SyncScopeAdapter,
    force: boolean,
  ): Promise<{
    row: LocalSyncScopeRow;
    requestId: string;
    inflightRevision: number;
    snapshot: unknown;
  } | null> {
    if (
      initial.inflightRequestId !== null
      && initial.inflightRevision !== null
      && initial.inflightSnapshotJson !== null
    ) {
      let snapshot: unknown;
      try {
        snapshot = parseSnapshot(initial.inflightSnapshotJson);
      } catch {
        await this.store.update(initial.scopeKey, (current) => ({
          ...current,
          status: 'dirty',
          attemptCount: 0,
          nextRetryAt: null,
          lastError: 'SYNC_INFLIGHT_SNAPSHOT_INVALID',
          inflightRequestId: null,
          inflightRevision: null,
          inflightSnapshotJson: null,
          updatedAt: this.now(),
        }));
        return null;
      }
      const row = await this.store.update(initial.scopeKey, (current) => ({
        ...current,
        status: 'syncing',
        attemptCount: force ? 0 : current.attemptCount,
        nextRetryAt: null,
        updatedAt: this.now(),
      }));
      if (!row) return null;
      return {
        row,
        requestId: initial.inflightRequestId,
        inflightRevision: initial.inflightRevision,
        snapshot,
      };
    }

    if (
      initial.inflightRequestId !== null
      || initial.inflightRevision !== null
      || initial.inflightSnapshotJson !== null
    ) {
      await this.store.update(initial.scopeKey, (current) => ({
        ...current,
        status: 'dirty',
        attemptCount: 0,
        nextRetryAt: null,
        lastError: 'SYNC_INFLIGHT_STATE_INVALID',
        inflightRequestId: null,
        inflightRevision: null,
        inflightSnapshotJson: null,
        updatedAt: this.now(),
      }));
      return null;
    }

    const capturedRevision = initial.localRevision;
    const snapshot = await adapter.buildSnapshot(initial.scopeKey);
    const snapshotJson = serializeSnapshot(snapshot);
    const requestId = this.createRequestId();

    const row = await this.store.update(initial.scopeKey, (current) => {
      if (
        current.localRevision !== capturedRevision
        || current.inflightRequestId !== null
      ) return current;
      return {
        ...current,
        status: 'syncing',
        attemptCount: force ? 0 : current.attemptCount,
        nextRetryAt: null,
        lastError: null,
        inflightRequestId: requestId,
        inflightRevision: capturedRevision,
        inflightSnapshotJson: snapshotJson,
        updatedAt: this.now(),
      };
    });
    if (!row || row.inflightRequestId !== requestId) return null;

    return {
      row,
      requestId,
      inflightRevision: capturedRevision,
      snapshot,
    };
  }

  private async pullUnlocked(scopeKey: string): Promise<SyncPullOutcome> {
    const row = await this.store.get(scopeKey);
    if (!row) return { kind: 'missing_scope' };
    if (row.status !== 'clean') {
      await this.store.update(scopeKey, (current) => ({
        ...current,
        remoteChanged: true,
        updatedAt: this.now(),
      }));
      return { kind: 'deferred' };
    }

    const adapter = this.adapterFor(row.scopeType);
    const expectedLocalRevision = row.localRevision;
    const remoteChangeCounter = row.remoteChangeCounter;

    try {
      const remote: SyncPullResult = await adapter.pull(scopeKey);
      if (remote.scopeKey !== scopeKey) throw new Error('SYNC_REMOTE_SCOPE_MISMATCH');
      if (row.serverRevision !== null && remote.serverRevision < row.serverRevision) {
        return { kind: 'stale' };
      }

      const applied = await adapter.applyRemoteSnapshotIfClean({
        scopeKey,
        expectedLocalRevision,
        serverRevision: remote.serverRevision,
        snapshot: remote.snapshot,
      });
      if (!applied) {
        await this.store.update(scopeKey, (current) => ({
          ...current,
          remoteChanged: true,
          updatedAt: this.now(),
        }));
        return { kind: 'deferred' };
      }

      await this.store.update(scopeKey, (current) => ({
        ...current,
        serverRevision: remote.serverRevision,
        remoteChanged: current.remoteChangeCounter !== remoteChangeCounter,
        lastError: null,
        updatedAt: this.now(),
      }));
      return { kind: 'applied', serverRevision: remote.serverRevision };
    } catch (error) {
      await this.store.update(scopeKey, (current) => ({
        ...current,
        remoteChanged: true,
        lastError: errorCode(error),
        updatedAt: this.now(),
      }));
      return { kind: 'failed', error: errorCode(error) };
    }
  }

  private adapterFor(scopeType: SyncScopeType): SyncScopeAdapter {
    const adapter = this.adapters.get(scopeType);
    if (!adapter) throw new Error(`SYNC_ADAPTER_MISSING:${scopeType}`);
    return adapter;
  }

  private retryDelay(attemptCount: number): number {
    const exponent = Math.max(0, attemptCount - 1);
    return Math.min(this.retryMaxMs, this.retryBaseMs * (2 ** exponent));
  }

  private async withScopeLock<T>(scopeKey: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(scopeKey) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.locks.set(scopeKey, current);
    try {
      return await current;
    } finally {
      if (this.locks.get(scopeKey) === current) this.locks.delete(scopeKey);
    }
  }
}
