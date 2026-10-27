/** Session-only, account-scoped technical Dexie Cloud timeline.
 * Never persist errors, credentials, user content, progress payloads or remote records.
 */
export type SyncHistoryEvent =
  | { at: number; source: 'sync'; phase: string; status: string }
  | { at: number; source: 'websocket'; status: string };

interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const SYNC_HISTORY_WINDOW_MS = 60 * 60 * 1000;
export const SYNC_HISTORY_LIMIT = 500;

const phases = new Set(['initial', 'not-in-sync', 'pushing', 'pulling', 'in-sync', 'error', 'offline']);
const statuses = new Set(['not-started', 'connecting', 'connected', 'disconnected', 'error', 'offline']);
const websocketStatuses = new Set(['not-started', 'connecting', 'connected', 'disconnected', 'error']);

function isEvent(value: unknown): value is SyncHistoryEvent {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  if (typeof entry.at !== 'number' || !Number.isFinite(entry.at)) return false;
  if (entry.source === 'sync') return typeof entry.phase === 'string' && phases.has(entry.phase)
    && typeof entry.status === 'string' && statuses.has(entry.status);
  return entry.source === 'websocket'
    && typeof entry.status === 'string' && websocketStatuses.has(entry.status);
}

function sessionStorageOrNull(): SessionStorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    // Private browsing or restricted WebViews can deny sessionStorage.
    return null;
  }
}

/** Instantiated once per verified Telegram account by CloudConnectionsProvider. */
export class SessionSyncHistory {
  private readonly key: string;
  private events: readonly SyncHistoryEvent[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(
    actorUserId: string,
    private readonly storage: SessionStorageLike | null = sessionStorageOrNull(),
    private readonly now: () => number = Date.now,
  ) {
    // The account only partitions browser-local sessionStorage keys; it is never an event field.
    this.key = `mezfit:dev-sync-history:v1:${actorUserId}`;
    try {
      const raw = this.storage?.getItem(this.key);
      if (raw) {
        const saved: unknown = JSON.parse(raw);
        if (Array.isArray(saved)) this.events = this.recent(saved.filter(isEvent));
      }
    } catch {
      // Corrupt/unavailable storage must not impact the app or cloud sync.
    }
  }

  readonly getSnapshot = (): readonly SyncHistoryEvent[] => this.events;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  recordSync(phase: string, status: string): void {
    if (!phases.has(phase) || !statuses.has(status)) return;
    this.record({ at: this.now(), source: 'sync', phase, status });
  }

  recordWebSocket(status: string): void {
    if (!websocketStatuses.has(status)) return;
    this.record({ at: this.now(), source: 'websocket', status });
  }

  prune(): void {
    const recent = this.recent(this.events);
    if (recent.length !== this.events.length) this.publish(recent);
  }

  clear(): void {
    if (this.events.length === 0) return;
    this.events = [];
    try { this.storage?.removeItem(this.key); } catch { /* optional local cache */ }
    this.emit();
  }

  private recent(events: readonly SyncHistoryEvent[]): readonly SyncHistoryEvent[] {
    const now = this.now();
    return events.filter(event => event.at <= now && event.at > now - SYNC_HISTORY_WINDOW_MS)
      .slice(-SYNC_HISTORY_LIMIT);
  }

  private record(next: SyncHistoryEvent): void {
    const previous = [...this.events].reverse().find(event => event.source === next.source);
    if (previous && previous.status === next.status
      && (previous.source === 'websocket'
        || (previous.source === 'sync' && next.source === 'sync' && previous.phase === next.phase))) {
      this.prune();
      return;
    }
    this.publish(this.recent([...this.events, next]));
  }

  private publish(events: readonly SyncHistoryEvent[]): void {
    this.events = events;
    try {
      if (events.length) this.storage?.setItem(this.key, JSON.stringify(events));
      else this.storage?.removeItem(this.key);
    } catch {
      // Fall back to volatile memory without failing an ordinary training action.
    }
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
