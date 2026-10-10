import type { Table } from 'dexie';
import type {
  LocalSyncScopeRow,
  MezfitLocalDatabase,
  SyncScopeType,
} from '../local';
import type { SyncStateStore } from './types';

function normalizeScope(row: LocalSyncScopeRow): LocalSyncScopeRow {
  return {
    ...row,
    inflightSnapshotJson: row.inflightSnapshotJson ?? null,
    remoteChangeCounter: row.remoteChangeCounter ?? 0,
  };
}

export function createSyncScopeRow(
  scopeKey: string,
  scopeType: SyncScopeType,
  now: number,
  serverRevision: number | null,
): LocalSyncScopeRow {
  return {
    scopeKey,
    scopeType,
    localRevision: 0,
    serverRevision,
    status: 'clean',
    attemptCount: 0,
    nextRetryAt: null,
    lastError: null,
    inflightRequestId: null,
    inflightRevision: null,
    inflightSnapshotJson: null,
    remoteChanged: false,
    remoteChangeCounter: 0,
    updatedAt: now,
  };
}

export interface SyncScopeTable {
  get(scopeKey: string): Promise<LocalSyncScopeRow | undefined>;
  put(row: LocalSyncScopeRow): Promise<unknown>;
}

export async function markSyncScopeDirty(
  table: SyncScopeTable,
  scopeKey: string,
  scopeType: SyncScopeType,
  options: {
    now?: number;
    initialServerRevision?: number | null;
  } = {},
): Promise<LocalSyncScopeRow> {
  const now = options.now ?? Date.now();
  const currentRaw = await table.get(scopeKey);
  const current = currentRaw
    ? normalizeScope(currentRaw)
    : createSyncScopeRow(
        scopeKey,
        scopeType,
        now,
        options.initialServerRevision ?? null,
      );

  if (current.scopeType !== scopeType) {
    throw new Error('SYNC_SCOPE_TYPE_MISMATCH');
  }

  const preserveInflight = current.status === 'syncing'
    || (
      current.status === 'retry_wait'
      && current.inflightRequestId !== null
    );

  const next: LocalSyncScopeRow = {
    ...current,
    localRevision: current.localRevision + 1,
    status: current.status === 'conflict'
      ? 'conflict'
      : preserveInflight
        ? current.status
        : 'dirty',
    attemptCount: preserveInflight ? current.attemptCount : 0,
    nextRetryAt: preserveInflight ? current.nextRetryAt : null,
    lastError: preserveInflight ? current.lastError : null,
    updatedAt: now,
  };
  await table.put(next);
  return next;
}

export async function recordHydratedSyncScope(
  table: SyncScopeTable,
  scopeKey: string,
  scopeType: SyncScopeType,
  serverRevision: number,
  now = Date.now(),
): Promise<LocalSyncScopeRow> {
  const raw = await table.get(scopeKey);
  if (!raw) {
    const created = createSyncScopeRow(scopeKey, scopeType, now, serverRevision);
    await table.put(created);
    return created;
  }

  const current = normalizeScope(raw);
  if (current.scopeType !== scopeType) throw new Error('SYNC_SCOPE_TYPE_MISMATCH');

  const clean = current.status === 'clean' && current.inflightRequestId === null;
  const baselineMissing = current.serverRevision === null;
  const changedRemotely = current.serverRevision !== null
    && current.serverRevision !== serverRevision;

  const next: LocalSyncScopeRow = clean
    ? {
        ...current,
        serverRevision,
        remoteChanged: current.remoteChanged,
        lastError: null,
        updatedAt: now,
      }
    : {
        ...current,
        serverRevision: baselineMissing ? serverRevision : current.serverRevision,
        remoteChanged: current.remoteChanged || changedRemotely,
        remoteChangeCounter: changedRemotely
          ? current.remoteChangeCounter + 1
          : current.remoteChangeCounter,
        updatedAt: now,
      };
  await table.put(next);
  return next;
}

export class DexieSyncStateStore implements SyncStateStore {
  constructor(private readonly db: MezfitLocalDatabase) {}

  async get(scopeKey: string): Promise<LocalSyncScopeRow | null> {
    const row = await this.db.syncScopes.get(scopeKey);
    return row ? normalizeScope(row) : null;
  }

  async ensure(
    scopeKey: string,
    scopeType: SyncScopeType,
    now: number,
  ): Promise<LocalSyncScopeRow> {
    return this.db.transaction('rw', this.db.syncScopes, async () => {
      const existing = await this.db.syncScopes.get(scopeKey);
      if (existing) {
        const normalized = normalizeScope(existing);
        if (normalized.scopeType !== scopeType) throw new Error('SYNC_SCOPE_TYPE_MISMATCH');
        return normalized;
      }
      const created = createSyncScopeRow(scopeKey, scopeType, now, null);
      await this.db.syncScopes.put(created);
      return created;
    });
  }

  async update(
    scopeKey: string,
    updater: (current: LocalSyncScopeRow) => LocalSyncScopeRow,
  ): Promise<LocalSyncScopeRow | null> {
    return this.db.transaction('rw', this.db.syncScopes, async () => {
      const row = await this.db.syncScopes.get(scopeKey);
      if (!row) return null;
      const next = updater(normalizeScope(row));
      await this.db.syncScopes.put(next);
      return next;
    });
  }

  async listAll(): Promise<LocalSyncScopeRow[]> {
    return (await this.db.syncScopes.toArray()).map(normalizeScope);
  }
}

export type LocalSyncScopeTable = Table<LocalSyncScopeRow, string>;
