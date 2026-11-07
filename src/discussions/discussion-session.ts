import type { DiscussionRepository, DiscussionPage } from '../data/cloud/discussions';
import type { DiscussionCursor, DiscussionMessageView } from '../data/cloud/discussion-views';
import type { DiscussionAnchor } from '../data/cloud/discussion-contracts';

/** Application port: the UI never receives IndexedDB, Addon or a second message store. */
export type DiscussionPort = Pick<DiscussionRepository, 'actorUserId' | 'listThreads' | 'page' | 'observePage'
  | 'getMessage' | 'send' | 'edit' | 'remove' | 'markRead' | 'getDraft' | 'saveDraft'> & {
    sync: Pick<DiscussionRepository['sync'], 'observe' | 'retry'>;
  };
export interface DiscussionTarget { threadId: string; anchor: DiscussionAnchor; focusMessageId?: string }
export interface DiscussionSnapshot {
  title: string; messages: DiscussionMessageView[]; loading: boolean; more: boolean; error: string | null;
}
type Subscription = { unsubscribe(): void };
const sameCursor = (a: DiscussionCursor | null, b: DiscussionCursor | null) => a?.id === b?.id && a?.createdAt === b?.createdAt;

/** Owns only the current live page projections; repository remains the data authority. */
export class DiscussionSession {
  private state: DiscussionSnapshot = { title: '', messages: [], loading: true, more: false, error: null };
  private listeners = new Set<() => void>();
  private waiters = new Set<() => void>();
  private pages: DiscussionPage[] = [];
  private subscriptions: Subscription[] = [];
  private pageTokens: object[] = [];
  private pageErrors = new Map<number, string>();
  private active = false;
  private generation = 0;
  private wanted = 1;
  private historyFloor: DiscussionCursor | null = null;
  private jumpGeneration = 0;
  constructor(readonly repository: DiscussionPort, readonly target: DiscussionTarget) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<DiscussionSnapshot>) {
    if (!this.active) return;
    this.state = { ...this.state, ...patch };
    this.notify();
  }
  private notify() {
    for (const listener of this.listeners) listener();
    this.notifyWaiters();
  }
  private notifyWaiters() { for (const waiter of this.waiters) waiter(); }
  start() {
    this.active = true;
    const generation = ++this.generation;
    this.publish({ loading: true, error: null });
    void this.repository.listThreads(this.target.anchor).then(threads => {
      if (!this.active || this.generation !== generation) return;
      const thread = threads.find(row => row.id === this.target.threadId);
      if (!thread) { this.publish({ loading: false, error: 'Ветка недоступна' }); return; }
      this.publish({ title: thread.derivedTitleSnapshot });
      this.attach(0);
    }, () => { if (this.generation === generation) this.publish({ loading: false, error: 'Не удалось открыть ветку' }); });
  }
  stop() {
    this.active = false; ++this.generation; ++this.jumpGeneration;
    this.dropFrom(0);
    this.notifyWaiters();
  }
  private dropFrom(index: number) {
    for (const page of this.pageErrors.keys()) if (page >= index) this.pageErrors.delete(page);
    this.pageTokens.splice(index);
    for (const sub of this.subscriptions.splice(index)) sub.unsubscribe();
    this.pages.splice(index);
  }
  private attach(index: number, before?: DiscussionCursor) {
    const token = {};
    this.pageTokens[index] = token;
    const current = () => this.active && this.pageTokens[index] === token;
    const sub = this.repository.observePage(this.target.threadId, page => {
      if (!current()) return;
      this.pageErrors.delete(index);
      const oldCursor = this.pages[index]?.before ?? null;
      const hadChildren = this.pageTokens.length > index + 1;
      this.pages[index] = page;
      if (hadChildren && !sameCursor(oldCursor, page.before)) this.dropFrom(index + 1);
      const oldest = page.messages[0];
      const lostHistory = this.historyFloor && oldest && (oldest.createdAt > this.historyFloor.createdAt
        || (oldest.createdAt === this.historyFloor.createdAt && oldest.id > this.historyFloor.id));
      if (page.before && (this.wanted > index + 1 || lostHistory) && !this.pageTokens[index + 1]) {
        this.attach(index + 1, page.before);
      }
      this.updateProjection();
    }, () => {
      if (!current()) return;
      this.pageErrors.set(index, 'Не удалось загрузить сообщения');
      this.publish({ loading: false, error: 'Не удалось загрузить сообщения' });
    }, before, 40);
    // observePage is asynchronous (Dexie liveQuery), so this assignment precedes its first result.
    this.subscriptions[index] = sub;
  }
  private updateProjection() {
    const rows = new Map<string, DiscussionMessageView>();
    // Latest page wins overlaps while neighbouring live cursors settle.
    for (const page of [...this.pages].reverse()) for (const row of page.messages) rows.set(row.id, row);
    const messages = [...rows.values()].sort((a, b) => a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const error = this.pageErrors.values().next().value ?? null;
    const loading = !error && this.pageTokens.length > this.pages.length;
    if (loading || error) {
      // Preserve the visible history while dependent cursors settle. Apply any
      // refreshed text/tombstone immediately without briefly removing older rows.
      this.publish({ messages: this.state.messages.map(row => rows.get(row.id) ?? row), loading, error });
    } else {
      // Preserve the revealed boundary, not just a fixed number of sliding pages.
      if (messages[0]) this.historyFloor = {
        createdAt: messages[0].createdAt, id: messages[0].id,
      };
      this.publish({ messages, loading, more: Boolean(this.pages.at(-1)?.before), error });
    }
  }
  loadMore = () => {
    const last = this.pages.at(-1);
    if (this.state.loading || this.state.error || !last?.before) return;
    this.wanted = this.pages.length + 1;
    this.publish({ loading: true });
    this.attach(this.pages.length, last.before);
  };
  retry = () => { this.dropFrom(0); this.start(); };
  cancelLocate = () => { ++this.jumpGeneration; this.notifyWaiters(); };
  private waitForPages(current: () => boolean): Promise<boolean> {
    return new Promise((resolve, reject) => {
      let unsubscribe = () => {};
      const check = () => {
        if (!current()) { unsubscribe(); resolve(false); }
        else if (this.state.error) { unsubscribe(); reject(new Error(this.state.error)); }
        else if (!this.state.loading) { unsubscribe(); resolve(true); }
      };
      this.waiters.add(check);
      unsubscribe = () => { this.waiters.delete(check); };
      check();
    });
  }
  /** Locate through repository pagination, with cancellation on close/switch/new jump. */
  async locate(id: string): Promise<boolean> {
    const request = ++this.jumpGeneration, generation = this.generation;
    const current = () => this.active && request === this.jumpGeneration && generation === this.generation;
    await this.repository.getMessage(this.target.threadId, id);
    // Resolve only after the exact target is present in the current live pages,
    // including page boundaries shifted by incoming messages during the jump.
    while (current() && await this.waitForPages(current)) {
      if (!current()) return false;
      if (this.state.messages.some(message => message.id === id)) return true;
      if (!this.pages.at(-1)?.before) return false;
      this.loadMore();
    }
    return false;
  }
}

