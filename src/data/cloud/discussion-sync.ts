import type { MezfitCloudDatabase } from './database';
export interface DiscussionSyncState { status: 'local' | 'synced' | 'error'; offline: boolean; error: string | null }
/** Session-local acknowledgement, not a second queue or a per-message receipt. */
export class DiscussionSync {
  private revision = 0;
  private confirmed = -1;
  private failed = false;
  private attempt = 0;
  private checking = false;
  private readonly listeners = new Set<(state: DiscussionSyncState) => void>();
  constructor(private readonly db: Pick<MezfitCloudDatabase, 'cloud'>) {}
  state(): DiscussionSyncState {
    const sync = this.db.cloud.syncState.value;
    const offline = sync.phase === 'offline' || sync.status === 'offline';
    const failed = this.failed || sync.phase === 'error' || sync.status === 'error';
    return { status: failed ? 'error' : !offline && this.confirmed >= this.revision ? 'synced' : 'local',
      offline, error: failed ? 'DISCUSSION_SYNC_FAILED' : null };
  }
  changed(): void { ++this.revision; this.emit(); this.acknowledge(); }
  private emit(): void { for (const listener of this.listeners) listener(this.state()); }
  private acknowledge(): void {
    const state = this.db.cloud.syncState.value;
    if (!this.listeners.size || this.checking || this.failed || this.confirmed >= this.revision
      || state.phase !== 'in-sync' || state.status !== 'connected') return;
    this.checking = true;
    // Errors are exposed through state(); Addon still owns transport/retries.
    void this.retry().catch(() => undefined).finally(() => {
      this.checking = false;
      if (!this.failed) this.acknowledge();
    });
  }
  observe(next: (state: DiscussionSyncState) => void): { unsubscribe(): void } {
    this.listeners.add(next);
    const subscription = this.db.cloud.syncState.subscribe({ next: () => { next(this.state()); this.acknowledge(); } });
    next(this.state());
    return { unsubscribe: () => { this.listeners.delete(next); subscription.unsubscribe(); } };
  }
  async retry(): Promise<void> {
    const revision = this.revision, attempt = ++this.attempt;
    this.failed = false; this.emit();
    try {
      await this.db.cloud.sync({ purpose: 'push', wait: true });
      this.confirmed = Math.max(this.confirmed, revision);
    } catch {
      if (attempt === this.attempt) this.failed = true;
      throw new Error('DISCUSSION_SYNC_FAILED');
    } finally { this.emit(); }
  }
}
