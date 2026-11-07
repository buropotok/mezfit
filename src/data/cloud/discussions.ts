import Dexie, { liveQuery } from 'dexie';
import { discussionAnchorKey, discussionId, discussionParents, discussionTitle } from '../../../shared/discussion-anchor';
import { assertDiscussionMessageWrite, assertDiscussionReadStateWrite, assertDiscussionThread, discussionReadStateId,
  type DiscussionAnchor, type DiscussionScope, type DiscussionThread, type DiscussionMessage } from './discussion-contracts';
import { discussionCursorKey, discussionCursorFromKey, discussionInstant, discussionMessageView, isDiscussionMessage,
  type DiscussionCursor, type DiscussionMessageView, type DiscussionReceiptSnapshot } from './discussion-views';
import { isApprovedAssignedPair } from './relationship-access';
import { DiscussionSync } from './discussion-sync';
import type { MezfitCloudDatabase } from './database';
export type DiscussionDatabase = Pick<MezfitCloudDatabase,
  'discussionThreads' | 'discussionMessages' | 'discussionReadStates' | 'realms' | 'members' | 'cloud'> & {
  /** Only the callback-based transaction capability is needed, not every app table on its context. */
  transaction<T>(mode: 'r' | 'rw', tables: readonly string[], task: () => Promise<T>): Promise<T>;
};
export interface CreateDiscussionThread { id: string; anchor: DiscussionAnchor; entityName: string; date: string; createdAt: string }
export interface DiscussionMessageInput {
  id: string; threadId: string; text: string; createdAt: string; replyToMessageId?: string;
  /** Composer publication must consume a private draft, not acknowledge another device's send. */
  requireUnsentDraft?: true;
}
export interface DiscussionPage { messages: DiscussionMessageView[]; before: DiscussionCursor | null }
export function prepareDiscussionMessage(threadId: string, text: string, replyToMessageId?: string): DiscussionMessageInput {
  return { id: crypto.randomUUID(), threadId, text, createdAt: new Date().toISOString(), replyToMessageId };
}
export function prepareDiscussionThread(anchor: DiscussionAnchor, entityName: string, date: string): CreateDiscussionThread {
  return { id: crypto.randomUUID(), anchor, entityName, date, createdAt: new Date().toISOString() };
}
/** Fixed-size, namespace-separated identity, independent of device, date and entity name. */
export async function entityDiscussionId(scope: DiscussionScope, anchor: DiscussionAnchor): Promise<string> {
  const bytes = new TextEncoder().encode(discussionAnchorKey(scope, anchor));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return 'entity-discussion:' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
function fail(code: string): never { throw new Error(code); }
const tables = ['discussionThreads', 'discussionMessages', 'discussionReadStates', 'realms', 'members'];

/** Account lifecycle owns db. No network, PLAN mutation or push in normal operations. */
export class DiscussionRepository {
  readonly sync: DiscussionSync;
  private readonly confirmedDelivery = new Map<string, Set<string>>();
  private readonly receiptObservers = new Map<string, Set<() => void>>();
  private readonly scope: DiscussionScope;
  constructor(private readonly db: DiscussionDatabase, readonly actorUserId: string, scope: DiscussionScope) {
    if (!/^tg:[1-9]\d*$/.test(actorUserId)) fail('INVALID_DISCUSSION_ACTOR');
    discussionAnchorKey(scope, { kind: 'program', trainingPlanId: 'validate-scope' });
    if (!db.discussionMessages?.schema.indexes.some(index => index.name === '[realmId+threadId+createdAt+id]')
      || !db.discussionReadStates?.schema.indexes.some(index => index.name === '[id+readThrough]')) fail('DISCUSSIONS_NOT_ENABLED');
    this.scope = { ...scope }; this.sync = new DiscussionSync(db);
  }
  private async access(): Promise<void> {
    if (this.scope.coachClientId === null) {
      if (this.scope.realmId !== this.actorUserId) fail('DISCUSSION_ACCESS_DENIED');
      return;
    }
    const [realm, members] = await Promise.all([this.db.realms.get(this.scope.realmId),
      this.db.members.where('realmId').equals(this.scope.realmId).toArray()]);
    const coach = members.find(member => member.roles?.includes('coach'))?.userId;
    const client = members.find(member => member.roles?.includes('client'))?.userId;
    if (!coach || !client || (this.actorUserId !== coach && this.actorUserId !== client)
      || !await isApprovedAssignedPair(realm, members, coach, client)) fail('DISCUSSION_ACCESS_DENIED');
  }
  private read<T>(task: () => Promise<T>): Promise<T> {
    return this.db.transaction('r', tables, async () => { await this.access(); return task(); });
  }
  private async write<T>(task: () => Promise<T>): Promise<T> {
    const result = await this.db.transaction('rw', tables, async () => { await this.access(); return task(); });
    this.sync.changed(); return result;
  }
  private async thread(id: string): Promise<DiscussionThread> {
    if (!discussionId(id)) fail('INVALID_DISCUSSION_ID');
    const row = await this.db.discussionThreads.get(id);
    if (!row || row.realmId !== this.scope.realmId || row.coachClientId !== this.scope.coachClientId) fail('DISCUSSION_NOT_FOUND');
    assertDiscussionThread(row); return row;
  }
  /** Only the canonical entry aggregates legacy rows; stored provenance never changes. */
  private async conversationThreads(threadId: string): Promise<DiscussionThread[]> {
    const thread = await this.thread(threadId);
    return threadId.startsWith('entity-discussion:') ? this.threads(thread.anchor) : [thread];
  }
  async ensureEntityThread(anchor: DiscussionAnchor, entityName: string): Promise<DiscussionThread> {
    const id = await entityDiscussionId(this.scope, anchor);
    const createdAt = new Date().toISOString();
    const row: DiscussionThread = { ...this.scope, id, owner: this.scope.realmId,
      anchor: structuredClone(anchor), anchorKey: discussionAnchorKey(this.scope, anchor),
      contextPath: discussionParents(anchor), derivedTitleSnapshot: entityName.trim(), createdAt, lastActivityAt: createdAt };
    assertDiscussionThread(row);
    return this.write(async () => {
      const existing = await this.db.discussionThreads.get(id);
      if (existing) {
        if (existing.realmId !== row.realmId || existing.coachClientId !== row.coachClientId
          || existing.anchorKey !== row.anchorKey) fail('DISCUSSION_ID_REUSED');
        assertDiscussionThread(existing); return existing;
      }
      await this.db.discussionThreads.add(row); return row;
    });
  }
  private visible(row: unknown, threadId: string): row is DiscussionMessage {
    return isDiscussionMessage(row) && !row.draftForRealmId && row.realmId === this.scope.realmId && row.threadId === threadId;
  }
  private async message(threadId: string, id: string): Promise<DiscussionMessage> {
    if (!discussionId(id)) fail('INVALID_DISCUSSION_ID');
    const row = await this.db.discussionMessages.get(id);
    if (!row || !(await this.conversationThreads(threadId)).some(thread => this.visible(row, thread.id))) fail('DISCUSSION_MESSAGE_NOT_FOUND');
    return row;
  }
  async createThread(input: CreateDiscussionThread): Promise<DiscussionThread> {
    if (typeof input.entityName !== 'string' || typeof input.date !== 'string') fail('INVALID_DISCUSSION_THREAD');
    const row: DiscussionThread = { ...this.scope, id: input.id, owner: this.scope.realmId,
      anchor: structuredClone(input.anchor), anchorKey: discussionAnchorKey(this.scope, input.anchor),
      contextPath: discussionParents(input.anchor), derivedTitleSnapshot: discussionTitle(input.entityName, input.date),
      createdAt: input.createdAt, lastActivityAt: input.createdAt };
    assertDiscussionThread(row);
    return this.write(async () => {
      const existing = await this.db.discussionThreads.get(row.id);
      if (existing) {
        if (existing.realmId !== row.realmId || existing.coachClientId !== row.coachClientId
          || existing.anchorKey !== row.anchorKey || existing.createdAt !== row.createdAt) fail('DISCUSSION_ID_REUSED');
        assertDiscussionThread(existing); return existing;
      }
      await this.db.discussionThreads.add(row); return row;
    });
  }
  private async threads(anchor: DiscussionAnchor): Promise<DiscussionThread[]> {
    const rows = await this.db.discussionThreads.where('[realmId+anchorKey]')
      .equals([this.scope.realmId, discussionAnchorKey(this.scope, anchor)]).toArray();
    const valid = rows.filter(row => { try { assertDiscussionThread(row); return row.coachClientId === this.scope.coachClientId; } catch { return false; } });
    // Activity hints can lag concurrent sends; derive the displayed timestamp from local messages.
    const projected = await Promise.all(valid.map(async row => {
      const latest = await this.db.discussionMessages.where('[realmId+threadId+createdAt+id]')
        // All timestamps/IDs are strings. One array upper bound sorts after every timestamp.
        .between([row.realmId, row.id, '', ''], [row.realmId, row.id, []], true, false)
        .reverse().filter(message => this.visible(message, row.id)).first();
      return latest && latest.createdAt > row.lastActivityAt ? { ...row, lastActivityAt: latest.createdAt } : row;
    }));
    return projected.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt) || a.id.localeCompare(b.id));
  }
  async listThreads(anchor: DiscussionAnchor): Promise<DiscussionThread[]> {
    return this.read(() => this.threads(anchor));
  }
  private async view(row: DiscussionMessage): Promise<DiscussionMessageView> {
    const reply = row.replyToMessageId ? await this.db.discussionMessages.get(row.replyToMessageId) : undefined;
    if (!isDiscussionMessage(reply) || reply.draftForRealmId || reply.realmId !== this.scope.realmId) return discussionMessageView(row);
    // Same-thread provenance is already established by the message read. Do not
    // add a second thread-header dependency to ordinary quote hydration.
    if (this.visible(reply, row.threadId)) return discussionMessageView(row, reply);
    // A reply may cross historical storage threads of this exact entity/pair.
    const root = await this.thread(row.threadId);
    const sourceThread = await this.db.discussionThreads.get(reply.threadId);
    let sameConversation = false;
    if (sourceThread) {
      try { assertDiscussionThread(sourceThread); sameConversation = sourceThread.realmId === root.realmId
        && sourceThread.coachClientId === root.coachClientId && sourceThread.anchorKey === root.anchorKey
        && this.visible(reply, sourceThread.id); } catch { /* An invalid quote stays unavailable. */ }
    }
    return discussionMessageView(row, sameConversation ? { ...reply, threadId: row.threadId } : undefined);
  }
  async getMessage(threadId: string, id: string): Promise<DiscussionMessageView> {
    return this.read(async () => { await this.thread(threadId); return this.view(await this.message(threadId, id)); });
  }
  async saveDraft(input: DiscussionMessageInput): Promise<void> {
    input = structuredClone(input);
    if (!discussionId(input.id) || (input.replyToMessageId !== undefined && !discussionId(input.replyToMessageId))
      || typeof input.text !== 'string' || input.text.length > 20000 || !discussionInstant(input.createdAt)) fail('INVALID_DISCUSSION_DRAFT');
    return this.write(async () => {
      await this.thread(input.threadId);
      if (input.replyToMessageId) await this.message(input.threadId, input.replyToMessageId);
      const previous = await this.db.discussionMessages.get(input.id);
      if (previous && (!isDiscussionMessage(previous) || previous.realmId !== this.actorUserId
        || previous.owner !== this.actorUserId || previous.threadId !== input.threadId
        || previous.draftForRealmId !== this.scope.realmId)) fail('DISCUSSION_ID_REUSED');
      const draft: DiscussionMessage = { id: input.id, threadId: input.threadId, text: input.text,
        createdAt: input.createdAt, replyToMessageId: input.replyToMessageId, realmId: this.actorUserId,
        owner: this.actorUserId, authorUserId: this.actorUserId, draftForRealmId: this.scope.realmId, deletedAt: '' };
      if (previous) await this.db.discussionMessages.where({ id: input.id, realmId: this.actorUserId,
        owner: this.actorUserId, draftForRealmId: this.scope.realmId }).modify({ text: input.text, replyToMessageId: input.replyToMessageId });
      else await this.db.discussionMessages.add(draft);
    });
  }
  /** Omit id to recover the newest private draft after closing/restarting the UI. */
  async getDraft(threadId: string, id?: string): Promise<DiscussionMessageInput | null> {
    if (id !== undefined && !discussionId(id)) fail('INVALID_DISCUSSION_ID');
    return this.read(async () => {
      await this.thread(threadId);
      const row = id !== undefined ? await this.db.discussionMessages.get(id)
        : (await this.db.discussionMessages.where('[realmId+threadId]').equals([this.actorUserId, threadId])
          .filter(candidate => isDiscussionMessage(candidate) && candidate.owner === this.actorUserId
            && !candidate.deletedAt && candidate.draftForRealmId === this.scope.realmId)
          .sortBy('createdAt')).at(-1);
      return isDiscussionMessage(row) && row.realmId === this.actorUserId && row.owner === this.actorUserId
        && !row.deletedAt && row.threadId === threadId && row.draftForRealmId === this.scope.realmId
        ? { id: row.id, threadId: row.threadId, text: row.text, createdAt: row.createdAt, replyToMessageId: row.replyToMessageId } : null;
    });
  }
  async discardDraft(threadId: string, id: string): Promise<void> {
    if (!discussionId(id)) fail('INVALID_DISCUSSION_ID');
    return this.write(async () => {
      await this.thread(threadId);
      const row = await this.db.discussionMessages.get(id);
      if (!row) return;
      if (!isDiscussionMessage(row) || row.realmId !== this.actorUserId || row.owner !== this.actorUserId
        || row.threadId !== threadId || row.draftForRealmId !== this.scope.realmId) fail('DISCUSSION_ACCESS_DENIED');
      await this.db.discussionMessages.where({ id, realmId: this.actorUserId,
        owner: this.actorUserId, draftForRealmId: this.scope.realmId }).delete();
    });
  }
  async send(input: DiscussionMessageInput): Promise<DiscussionMessageView> {
    input = structuredClone(input);
    if (!discussionId(input.id) || !discussionInstant(input.createdAt)
      || (input.requireUnsentDraft !== undefined && input.requireUnsentDraft !== true)) fail('INVALID_DISCUSSION_MESSAGE');
    if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 20000) fail('DISCUSSION_TEXT_REQUIRED');
    return this.write(async () => {
      const thread = await this.thread(input.threadId);
      const existing = await this.db.discussionMessages.get(input.id);
      if (existing && !existing.draftForRealmId) {
        if (!this.visible(existing, thread.id) || existing.authorUserId !== this.actorUserId
          || existing.replyToMessageId !== input.replyToMessageId) fail('DISCUSSION_ID_REUSED');
        if (input.requireUnsentDraft) fail('DISCUSSION_DRAFT_ALREADY_PUBLISHED');
        return this.view(existing);
      }
      if (input.requireUnsentDraft && !existing) fail('DISCUSSION_DRAFT_NOT_SAVED');
      if (existing && (!isDiscussionMessage(existing) || existing.owner !== this.actorUserId
        || existing.realmId !== this.actorUserId || existing.threadId !== thread.id || existing.draftForRealmId !== this.scope.realmId)) fail('DISCUSSION_ID_REUSED');
      const reply = input.replyToMessageId ? await this.message(thread.id, input.replyToMessageId) : undefined;
      // Draft creation is private, not publication. Freeze the first local send
      // time on the row; retries above return that same row without moving it.
      const row: DiscussionMessage = { id: input.id, threadId: input.threadId, text: input.text,
        createdAt: existing ? new Date().toISOString() : input.createdAt,
        replyToMessageId: input.replyToMessageId, realmId: this.scope.realmId,
        owner: this.actorUserId, authorUserId: this.actorUserId, deletedAt: '' };
      assertDiscussionMessageWrite(this.actorUserId, thread, row, undefined, reply ? { ...reply, threadId: thread.id } : undefined);
      if (existing) await this.db.discussionMessages.where({ id: row.id, realmId: this.actorUserId,
        owner: this.actorUserId, draftForRealmId: this.scope.realmId }).modify({ realmId: row.realmId, draftForRealmId: undefined,
        text: row.text, createdAt: row.createdAt, replyToMessageId: row.replyToMessageId });
      else await this.db.discussionMessages.add(row);
      if (row.createdAt > thread.lastActivityAt) await this.db.discussionThreads
        .where({ id: thread.id, lastActivityAt: thread.lastActivityAt }).modify({ lastActivityAt: row.createdAt });
      return this.view(row);
    });
  }
  async edit(threadId: string, id: string, text: string): Promise<void> {
    if (typeof text !== 'string' || !text.trim() || text.length > 20000) fail('DISCUSSION_TEXT_REQUIRED');
    return this.write(async () => {
      const row = await this.message(threadId, id), thread = await this.thread(row.threadId);
      if (row.deletedAt) fail('DISCUSSION_MESSAGE_DELETED');
      const patch = { text, editedAt: new Date().toISOString() };
      const source = row.replyToMessageId ? await this.db.discussionMessages.get(row.replyToMessageId) : undefined;
      assertDiscussionMessageWrite(this.actorUserId, thread, { ...row, ...patch }, row, this.visible(source, row.threadId) ? source : undefined);
      const changed = await this.db.discussionMessages.where({ id, realmId: row.realmId, threadId: row.threadId,
        owner: this.actorUserId, authorUserId: this.actorUserId, deletedAt: '' }).modify(patch);
      if (!changed) fail('DISCUSSION_MESSAGE_CHANGED');
    });
  }
  async remove(threadId: string, id: string): Promise<void> {
    return this.write(async () => {
      const row = await this.message(threadId, id), thread = await this.thread(row.threadId);
      if (row.owner !== this.actorUserId || row.authorUserId !== this.actorUserId) fail('DISCUSSION_ACCESS_DENIED');
      if (row.deletedAt) return;
      const patch = { text: '', deletedAt: new Date().toISOString() };
      const source = row.replyToMessageId ? await this.db.discussionMessages.get(row.replyToMessageId) : undefined;
      assertDiscussionMessageWrite(this.actorUserId, thread, { ...row, ...patch }, row, this.visible(source, row.threadId) ? source : undefined);
      await this.db.discussionMessages.where({ id, realmId: row.realmId, owner: this.actorUserId }).modify(patch);
    });
  }
  async page(threadId: string, before?: DiscussionCursor, limit = 40): Promise<DiscussionPage> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100
      || (before && (!discussionInstant(before.createdAt) || !discussionId(before.id)))) fail('INVALID_DISCUSSION_PAGE');
    if (!discussionId(threadId)) fail('INVALID_DISCUSSION_ID');
    // Keep the complete page/quote read in Dexie's promise zone. Async per-row
    // projections can outlive the last IndexedDB request under liveQuery.
    return this.read(() => this.db.discussionThreads.get(threadId).then(root => {
      if (!root || root.realmId !== this.scope.realmId || root.coachClientId !== this.scope.coachClientId) fail('DISCUSSION_NOT_FOUND');
      assertDiscussionThread(root);
      const headers = threadId.startsWith('entity-discussion:')
        ? this.db.discussionThreads.where('[realmId+anchorKey]').equals([this.scope.realmId, root.anchorKey]).toArray()
        : Dexie.Promise.resolve([root]);
      return headers.then(candidates => {
        const threads = candidates.filter(thread => {
          try { assertDiscussionThread(thread); return thread.realmId === root.realmId
            && thread.coachClientId === root.coachClientId && thread.anchorKey === root.anchorKey; }
          catch { return false; }
        });
        return Dexie.Promise.all(threads.map(thread => this.db.discussionMessages.where('[realmId+threadId+createdAt+id]')
          .between([this.scope.realmId, thread.id, '', ''],
            before ? [this.scope.realmId, thread.id, before.createdAt, before.id]
              : [this.scope.realmId, thread.id, []], true, false)
          .reverse().filter(row => this.visible(row, thread.id)).limit(limit + 1).toArray())).then(pages => {
          const rows = pages.flat().sort((a, b) => discussionCursorKey(a) < discussionCursorKey(b) ? 1 : -1);
          const more = rows.length > limit; rows.splice(limit);
          const cursor = more && rows.length ? { createdAt: rows[rows.length - 1].createdAt, id: rows[rows.length - 1].id } : null;
          const replyIds = [...new Set(rows.flatMap(row => row.replyToMessageId ? [row.replyToMessageId] : []))];
          return this.db.discussionMessages.bulkGet(replyIds).then(originals => {
            const threadIds = new Set(threads.map(thread => thread.id));
            const quotes = new Map(originals.filter((row): row is DiscussionMessage => isDiscussionMessage(row)
              && this.visible(row, row.threadId) && threadIds.has(row.threadId)).map(row => [row.id, row]));
            const messages = rows.reverse().map(row => {
              const original = row.replyToMessageId ? quotes.get(row.replyToMessageId) : undefined;
              return discussionMessageView(row, original ? { ...original, threadId: row.threadId } : undefined);
            });
            return { messages, before: cursor };
          });
        });
      });
    }));
  }

  async markRead(threadId: string, messageId: string): Promise<void> {
    return this.write(async () => {
      const message = await this.message(threadId, messageId);
      const through = discussionCursorKey(message);
      for (const thread of await this.conversationThreads(threadId)) {
        const latest = await this.db.discussionMessages.where('[realmId+threadId+createdAt+id]')
          .between([this.scope.realmId, thread.id, '', ''], [this.scope.realmId, thread.id, message.createdAt, message.id], true, true)
          .reverse().filter(row => this.visible(row, thread.id)).first();
        if (!latest) continue;
        const id = discussionReadStateId(this.scope.realmId, thread.id, this.actorUserId);
        let state = await this.db.discussionReadStates.get(id);
        if (!state) {
          // Keep creation separate from advancement: concurrent offline devices
          // replay the same monotone range predicate rather than competing full watermarks.
          state = { id, realmId: this.scope.realmId, owner: this.actorUserId, threadId: thread.id,
            userId: this.actorUserId, lastReadMessageId: null, lastReadAt: new Date(0).toISOString(), readThrough: '' };
          assertDiscussionReadStateWrite(this.actorUserId, thread, state);
          await this.db.discussionReadStates.add(state);
        }
        if (state && (state.owner !== this.actorUserId || state.userId !== this.actorUserId
          || state.realmId !== this.scope.realmId || state.threadId !== thread.id)) fail('DISCUSSION_ACCESS_DENIED');
        if (state?.readThrough !== undefined && state.readThrough !== '' && (!discussionCursorFromKey(state.readThrough)
          || discussionCursorFromKey(state.readThrough)?.id !== state.lastReadMessageId)) fail('DISCUSSION_READ_STATE_REQUIRES_VALIDATION');
        const previous = state?.lastReadMessageId ? await this.db.discussionMessages.get(state.lastReadMessageId) : undefined;
        assertDiscussionReadStateWrite(this.actorUserId, thread, state, this.visible(previous, thread.id) ? previous : undefined);
        const oldCursor = discussionCursorFromKey(state?.readThrough);
        const oldThrough = oldCursor && oldCursor.id === state?.lastReadMessageId ? discussionCursorKey(oldCursor)
          : this.visible(previous, thread.id) ? discussionCursorKey(previous) : '';
        const readThrough = discussionCursorKey(latest);
        if (oldThrough > through || (oldThrough >= readThrough && state?.readThrough === oldThrough)) continue;
        const patch = { lastReadMessageId: latest.id,
          lastReadAt: new Date(Math.max(Date.now(), Date.parse(state.lastReadAt) + 1)).toISOString(), readThrough };
        const next = { id, realmId: this.scope.realmId, owner: this.actorUserId, threadId: thread.id,
          userId: this.actorUserId, ...patch };
        assertDiscussionReadStateWrite(this.actorUserId, thread, next, latest);
        if (state.readThrough === undefined) {
          // Legacy rows were not indexed by readThrough. Upgrade only the observed version.
          await this.db.discussionReadStates.where('[id+lastReadAt]').equals([id, state.lastReadAt]).modify(patch);
        } else await this.db.discussionReadStates.where('[id+readThrough]')
          .between([id, ''], [id, readThrough], true, false).modify(patch);
      }
    });
  }
  private async countUnread(threadId: string): Promise<number> {
    const state = await this.db.discussionReadStates.get(discussionReadStateId(this.scope.realmId, threadId, this.actorUserId));
    const cursor = discussionCursorFromKey(state?.readThrough);
    const through = state?.owner === this.actorUserId && state.userId === this.actorUserId
      && state.realmId === this.scope.realmId && state.threadId === threadId && cursor && cursor.id === state.lastReadMessageId
      ? discussionCursorKey(cursor) : '';
    return this.db.discussionMessages.where('[realmId+threadId+createdAt+id]')
      .between([this.scope.realmId, threadId, cursor && through ? cursor.createdAt : '', cursor && through ? cursor.id : ''],
        [this.scope.realmId, threadId, []], !through, false)
      .filter(row => this.visible(row, threadId) && row.authorUserId !== this.actorUserId && !row.deletedAt).count();
  }
  async unread(threadId: string): Promise<number> {
    return this.read(async () => (await Promise.all((await this.conversationThreads(threadId))
      .map(thread => this.countUnread(thread.id)))).reduce((sum, count) => sum + count, 0));
  }
  async unreadForAnchor(anchor: DiscussionAnchor): Promise<number> {
    return this.read(async () => {
      const threads = await this.threads(anchor);
      return (await Promise.all(threads.map(thread => this.countUnread(thread.id)))).reduce((a, b) => a + b, 0);
    });
  }
  observePage(threadId: string, next: (page: DiscussionPage) => void, error: (reason: unknown) => void,
    before?: DiscussionCursor, limit = 40): { unsubscribe(): void } {
    return liveQuery(() => this.page(threadId, before, limit)).subscribe({ next, error });
  }
  /**
   * A remote participant's readThrough is an authored, replicated read-state row.
   * The current user's own watermark is never evidence that the recipient read a message.
   */
  observeReceipts(threadId: string, next: (value: DiscussionReceiptSnapshot) => void,
    error: (reason: unknown) => void): { unsubscribe(): void } {
    let recipientReadThrough: DiscussionReceiptSnapshot['recipientReadThrough'] = [];
    const emit = () => next({ confirmedIds: [...(this.confirmedDelivery.get(threadId) ?? [])], recipientReadThrough });
    const observers = this.receiptObservers.get(threadId) ?? new Set<() => void>();
    observers.add(emit);
    this.receiptObservers.set(threadId, observers);
    const subscription = liveQuery(() => this.read(async () => {
      const threads = await this.conversationThreads(threadId);
      const states = (await Promise.all(threads.map(thread => this.db.discussionReadStates.where('[realmId+threadId+userId]')
        .between([this.scope.realmId, thread.id, ''], [this.scope.realmId, thread.id, []], true, false).toArray()))).flat();
      return states.flatMap(state => {
        const cursor = discussionCursorFromKey(state.readThrough);
        return state.realmId === this.scope.realmId && threads.some(thread => thread.id === state.threadId)
          && state.userId !== this.actorUserId && state.owner === state.userId
          && /^tg:[1-9]\d*$/.test(state.userId)
          && state.id === discussionReadStateId(this.scope.realmId, state.threadId, state.userId)
          && cursor && cursor.id === state.lastReadMessageId ? [threadId.startsWith('entity-discussion:') ? { ...cursor, threadId: state.threadId } : cursor] : [];
      });
    })).subscribe({ next: cursors => { recipientReadThrough = cursors; emit(); }, error });
    return { unsubscribe: () => {
      observers.delete(emit);
      if (!observers.size) this.receiptObservers.delete(threadId);
      subscription.unsubscribe();
    } };
  }

  /**
   * A push acknowledgement is attached to these message IDs only after their
   * committed rows existed before the Addon's awaited push and still exist after it.
   * It is intentionally not inferred from DiscussionSync.status, nor persisted as
   * a fictitious server receipt. On a new session the repository can recheck IDs.
   */
  async confirmDelivery(threadId: string, messageIds: readonly string[]): Promise<void> {
    const alreadyConfirmed = this.confirmedDelivery.get(threadId);
    const ids = [...new Set(messageIds)].filter(id => discussionId(id) && !alreadyConfirmed?.has(id));
    if (!ids.length) return;
    const before = await this.read(async () => {
      await this.thread(threadId);
      const rows = await Promise.all(ids.map(id => this.db.discussionMessages.get(id)));
      const threads = await this.conversationThreads(threadId);
      return rows.filter((row): row is DiscussionMessage => threads.some(thread => this.visible(row, thread.id)) && isDiscussionMessage(row)
        && row.authorUserId === this.actorUserId && !row.deletedAt).map(row => row.id);
    });
    if (!before.length) return;
    await this.db.cloud.sync({ purpose: 'push', wait: true });
    const confirmed = await this.read(async () => {
      await this.thread(threadId);
      return (await Promise.all(before.map(async id => {
        try {
          const row = await this.message(threadId, id);
          return row.authorUserId === this.actorUserId && !row.deletedAt ? id : null;
        } catch { return null; }
      }))).filter((id): id is string => id !== null);
    });
    if (!confirmed.length) return;
    const confirmedForThread = this.confirmedDelivery.get(threadId) ?? new Set<string>();
    for (const id of confirmed) confirmedForThread.add(id);
    this.confirmedDelivery.set(threadId, confirmedForThread);
    for (const notify of this.receiptObservers.get(threadId) ?? []) notify();
  }

  observeAnchor(anchor: DiscussionAnchor, next: (value: { threads: DiscussionThread[]; unread: number; unreadByThread: Record<string, number> }) => void,
    error: (reason: unknown) => void): { unsubscribe(): void } {
    return liveQuery(() => this.read(async () => {
      const threads = await this.threads(anchor);
      const counts = await Promise.all(threads.map(thread => this.countUnread(thread.id)));
      const unreadByThread = Object.fromEntries(threads.map((thread, index) => [thread.id, counts[index]]));
      return { threads, unread: counts.reduce((a, b) => a + b, 0), unreadByThread };
    })).subscribe({ next, error });
  }
}
