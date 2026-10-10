import type {
  SyncPullResult,
  SyncPushEnvelope,
  SyncPushResult,
} from '../../../shared/sync';
import type { LocalSyncScopeRow, SyncScopeType } from '../local';

export interface SyncScopeAdapter {
  readonly scopeType: SyncScopeType;
  buildSnapshot(scopeKey: string): Promise<unknown>;
  push(envelope: SyncPushEnvelope): Promise<SyncPushResult>;
  pull(scopeKey: string): Promise<SyncPullResult>;
  /**
   * Apply the remote snapshot atomically with guards that the scope is still clean
   * at expectedLocalRevision and still has expectedServerRevision. Return false
   * without mutating domain data when either guard fails.
   */
  applyRemoteSnapshotIfClean(input: {
    scopeKey: string;
    expectedLocalRevision: number;
    expectedServerRevision: number | null;
    serverRevision: number;
    snapshot: unknown;
  }): Promise<boolean>;
}

export interface SyncStateStore {
  get(scopeKey: string): Promise<LocalSyncScopeRow | null>;
  ensure(
    scopeKey: string,
    scopeType: SyncScopeType,
    now: number,
  ): Promise<LocalSyncScopeRow>;
  update(
    scopeKey: string,
    updater: (current: LocalSyncScopeRow) => LocalSyncScopeRow,
  ): Promise<LocalSyncScopeRow | null>;
  listAll(): Promise<LocalSyncScopeRow[]>;
}

export class SyncTransportError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly code = 'SYNC_TRANSPORT_ERROR',
  ) {
    super(message);
    this.name = 'SyncTransportError';
  }
}

export type SyncFlushOutcome =
  | { kind: 'clean' }
  | { kind: 'accepted'; serverRevision: number; newerLocalChanges: boolean }
  | { kind: 'conflict'; serverRevision: number }
  | { kind: 'retry_wait'; nextRetryAt: number | null; attemptCount: number }
  | {
      kind: 'skipped';
      reason:
        | 'missing_scope'
        | 'conflict'
        | 'not_due'
        | 'manual_only'
        | 'server_revision_unknown'
        | 'changed_during_snapshot';
    };

export type SyncPullOutcome =
  | { kind: 'applied'; serverRevision: number }
  | { kind: 'deferred' }
  | { kind: 'stale' }
  | { kind: 'missing_scope' }
  | { kind: 'failed'; error: string };
