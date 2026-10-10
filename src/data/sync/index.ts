export { SyncEngine, type SyncEngineOptions } from './SyncEngine';
export { SyncWorker, type SyncWorkerOptions } from './SyncWorker';
export {
  DexieSyncStateStore,
  createSyncScopeRow,
  markSyncScopeDirty,
  recordHydratedSyncScope,
  type SyncScopeTable,
} from './state';
export {
  SyncTransportError,
  type SyncFlushOutcome,
  type SyncPullOutcome,
  type SyncScopeAdapter,
  type SyncStateStore,
} from './types';
