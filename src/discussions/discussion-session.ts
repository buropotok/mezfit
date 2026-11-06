import type { DiscussionRepository, DiscussionPage } from '../data/cloud/discussions';
import type { DiscussionCursor, DiscussionMessageView } from '../data/cloud/discussion-views';
import type { DiscussionAnchor } from '../data/cloud/discussion-contracts';

/** Application port: the UI never receives IndexedDB, Addon or a second message store. */
export type DiscussionPort = Pick<DiscussionRepository, 'actorUserId' | 'listThreads' | 'page' | 'observePage'
  | 'getMessage' | 'send' | 'edit' | 'remove' | 'markRead'> & {
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
  private pages: DiscussionPage[] = [];
  private subscriptions: Subscription[] = [];
  private pageTokens: object[] = [];
  private active = false;
  private generation = 0;
  private wanted = 1;
  private jumpGeneration = 0;
  constructor(readonly repository: DiscussionPort, readonly target: DiscussionTarget) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<DiscussionSnapshot>) {
    if (!this.active) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
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
  }
  private dropFrom(index: number) {
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
      const oldCursor = this.pages[index]?.before ?? null;
      const hadChildren = this.pageTokens.length > index + 1;
      this.pages[index] = page;
      if (hadChildren && !sameCursor(oldCursor, page.before)) this.dropFrom(index + 1);
      this.updateProjection();
      if (page.before && this.wanted > index + 1 && !this.pageTokens[index + 1]) {
        this.publish({ loading: true });
        this.attach(index + 1, page.before);
      }
    }, () => { if (current()) this.publish({ loading: false, error: 'Не удалось загрузить сообщения' }); }, before, 40);
    // observePage is asynchronous (Dexie liveQuery), so this assignment precedes its first result.
    this.subscriptions[index] = sub;
  }
  private updateProjection() {
    const rows = new Map<string, DiscussionMessageView>();
    // Latest page wins overlaps while neighbouring live cursors settle.
    for (const page of [...this.pages].reverse()) for (const row of page.messages) rows.set(row.id, row);
    const messages = [...rows.values()].sort((a, b) => a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    this.publish({ messages, loading: this.pageTokens.length > this.pages.length,
      more: Boolean(this.pages.at(-1)?.before), error: null });
  }
  loadMore = () => {
    const last = this.pages.at(-1);
    if (this.state.loading || !last?.before) return;
    this.wanted = this.pages.length + 1;
    this.publish({ loading: true });
    this.attach(this.pages.length, last.before);
  };
  retry = () => { this.dropFrom(0); this.wanted = 1; this.start(); };
  cancelLocate = () => { ++this.jumpGeneration; };
  /** Locate through repository pagination, with cancellation on close/switch/new jump. */
  async locate(id: string): Promise<boolean> {
    const request = ++this.jumpGeneration, generation = this.generation;
    const current = () => this.active && request === this.jumpGeneration && generation === this.generation;
    await this.repository.getMessage(this.target.threadId, id);
    if (!current()) return false;
    if (this.state.messages.some(message => message.id === id)) return true;
    let before = this.pages.at(-1)?.before;
    let count = this.pages.length;
    while (before && current()) {
      const page = await this.repository.page(this.target.threadId, before, 40);
      if (!current()) return false;
      ++count;
      if (page.messages.some(message => message.id === id)) {
        this.wanted = count;
        // Rebuild the live chain, including any newer messages received during the search.
        this.dropFrom(0); this.publish({ loading: true }); this.attach(0);
        return true;
      }
      before = page.before;
    }
    return false;
  }
}
