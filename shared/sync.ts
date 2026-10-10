export interface SyncPushEnvelope<TSnapshot = unknown> {
  requestId: string;
  scopeKey: string;
  baseServerRevision: number;
  snapshot: TSnapshot;
}

export type SyncPushResult =
  | { kind: 'accepted'; serverRevision: number }
  | { kind: 'conflict'; serverRevision: number };

export interface SyncPullResult<TSnapshot = unknown> {
  scopeKey: string;
  serverRevision: number;
  snapshot: TSnapshot;
}
