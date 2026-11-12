// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie, { type Table } from 'dexie';
import dexieCloud from 'dexie-cloud-addon';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import { CLOUD_DATABASE_STORES_V15, CLOUD_DATABASE_STORES_V16, CLOUD_DATABASE_STORES_V17, CLOUD_DISCUSSION_DATABASE_VERSION, MezfitCloudDatabase } from './database';
import { DiscussionRepository, prepareDiscussionMessage, prepareDiscussionThread, entityDiscussionId } from './discussions';
import { discussionMessageView } from './discussion-views';
import { assertMessageAttachmentWrite, type DiscussionMessage, type DiscussionThread, type DiscussionReadState } from './discussion-contracts';
class TestDatabase extends Dexie {
  declare discussionThreads: Table<DiscussionThread, string>;
  declare discussionMessages: Table<DiscussionMessage, string>;
  declare discussionReadStates: Table<DiscussionReadState, string>;
  constructor(name = 'discussions-' + crypto.randomUUID(), version = 16) {
    super(name, { addons: [dexieCloud] });
    this.version(15).stores(CLOUD_DATABASE_STORES_V15);
    if (version === 16) {
      this.version(16).stores(CLOUD_DATABASE_STORES_V16);
      this.version(17).stores(CLOUD_DATABASE_STORES_V17);
    }
    this.cloud.configure({ databaseUrl: '', requireAuth: false, disableEagerSync: true,
      disableWebSocket: true, tryUseServiceWorker: false, unsyncedTables: ['localWorkoutOccurrenceDrafts'] });
    databases.push(this);
  }
}
const databases: Dexie[] = [];
afterEach(async () => {
  for (const db of databases) db.close();
  for (const db of new Map(databases.splice(0).map(db => [db.name, db])).values()) await db.delete();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function fixture() {
  const fetch = vi.fn(() => Promise.reject(new Error('Unexpected network'))); vi.stubGlobal('fetch', fetch);
  const db = new TestDatabase(); await db.open();
  const pair = await relationshipMembership('11', '22'), other = await relationshipMembership('33', '22');
  // Seed Worker-provisioned infrastructure without unauthenticated owner rewriting.
  await new Promise<void>((resolve, reject) => {
    const tx = db.backendDB().transaction(['realms', 'members'], 'readwrite');
    for (const item of [pair, other]) {
      tx.objectStore('realms').put(item.realm);
      for (const member of item.members) tx.objectStore('members').put(member);
    }
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
  });
  const scope = { realmId: pair.realm.realmId, coachClientId: pair.realm.realmId };
  const coach = new DiscussionRepository(db, 'tg:11', scope), client = new DiscussionRepository(db, 'tg:22', scope);
  const anchor = { kind: 'program' as const, trainingPlanId: 'program' };
  const command = prepareDiscussionThread(anchor, 'Программа', '2026-11-06');
  const thread = await coach.createThread(command);
  return { db, coach, client, scope, anchor, command, thread, fetch, other };
}

describe('COMM-04 with pinned Addon and local IndexedDB; not live server ACL tests', () => {
  it('queries empty threads and string cursor bounds without including a neighbouring thread', async () => {
    const { coach, client, thread, anchor } = await fixture();
    expect(await client.page(thread.id)).toEqual({ messages: [], before: null });
    expect(await client.unread(thread.id)).toBe(0);
    expect(await client.unreadForAnchor(anchor)).toBe(0);
    const neighbour = await coach.createThread(prepareDiscussionThread(anchor, 'Другая ветка', '2026-11-06'));
    await coach.send(prepareDiscussionMessage(neighbour.id, 'Другая ветка'));
    const input = { id: '\uffff\uffff', threadId: thread.id, text: 'Последний строковый ID', createdAt: '2026-11-06T12:00:00.000Z' };
    await coach.send(input);
    expect((await client.page(thread.id)).messages.map(row => row.id)).toEqual([input.id]);
    expect((await client.page(thread.id, input)).messages).toEqual([]);
    expect(await client.unread(thread.id)).toBe(1);
    await client.markRead(thread.id, input.id);
    expect(await client.unread(thread.id)).toBe(0);
    expect(await client.unreadForAnchor(anchor)).toBe(1);
  });
  it('creates multiple titled threads, deduplicates retry and accepts offline writes without push', async () => {
    const { db, coach, client, command, thread, anchor, fetch } = await fixture();
    expect((await coach.createThread(command)).id).toBe(thread.id);
    const second = await coach.createThread(prepareDiscussionThread(anchor, 'Программа', '2026-11-06'));
    expect(second.id).not.toBe(thread.id);
    expect((await coach.listThreads(anchor)).map(row => row.derivedTitleSnapshot)).toEqual(['Программа · 2026-11-06', 'Программа · 2026-11-06']);
    const input = prepareDiscussionMessage(thread.id, 'Первое сообщение');
    expect(await coach.send(input)).toMatchObject({ id: input.id, text: input.text, deleted: false });
    await coach.send(input); expect(await db.discussionMessages.count()).toBe(1);
    expect((await client.page(thread.id)).messages[0].text).toBe(input.text);
    await expect(coach.send(prepareDiscussionMessage(thread.id, '   '))).rejects.toThrow('DISCUSSION_TEXT_REQUIRED');
    expect(fetch).not.toHaveBeenCalled();
    expect(db.cloud.schema?.discussionMessages.markedForSync).toBe(true);
    expect(db.cloud.schema?.discussionReadStates.markedForSync).toBe(true);
    expect(coach.sync.state().status).toBe('local');
  });
  it('keeps unsent drafts private across reopen; sends the same ID and does not overwrite edits/deletes on retry', async () => {
    const { db, coach, client, thread } = await fixture();
    const input = prepareDiscussionMessage(thread.id, 'Черновик');
    await coach.saveDraft({ ...input, text: '' }); await coach.saveDraft(input);
    expect((await db.discussionMessages.get(input.id))?.realmId).toBe('tg:11');
    expect((await client.page(thread.id)).messages).toEqual([]);
    expect(await client.getDraft(thread.id, input.id)).toBeNull();
    db.close(); await db.open();
    expect((await coach.getDraft(thread.id, input.id))?.text).toBe(input.text);
    await expect(coach.send({ ...input, text: '' })).rejects.toThrow('DISCUSSION_TEXT_REQUIRED');
    expect((await coach.getDraft(thread.id, input.id))?.text).toBe(input.text);
    await coach.send(input); expect(await coach.getDraft(thread.id, input.id)).toBeNull();
    expect(await db.discussionMessages.count()).toBe(1);
    await coach.edit(thread.id, input.id, 'Изменённый текст'); await coach.send(input);
    expect((await client.getMessage(thread.id, input.id)).text).toBe('Изменённый текст');
    await coach.remove(thread.id, input.id); await coach.send(input);
    expect(await client.getMessage(thread.id, input.id)).toMatchObject({ text: '', deleted: true });
    await expect(coach.discardDraft(thread.id, input.id)).rejects.toThrow('DISCUSSION_ACCESS_DENIED');
    const cancelled = prepareDiscussionMessage(thread.id, 'Не отправлять');
    await coach.saveDraft(cancelled); await coach.discardDraft(thread.id, cancelled.id);
    expect(await db.discussionMessages.get(cancelled.id)).toBeUndefined();
  });
  it('derives quotes from current originals, clears deleted text and rejects cross-thread replies atomically', async () => {
    const { db, coach, client, thread, anchor } = await fixture();
    const original = await coach.send(prepareDiscussionMessage(thread.id, 'Первая строка\nВторая строка'));
    const reply = await client.send(prepareDiscussionMessage(thread.id, 'Ответ', original.id));
    expect(reply.reply).toMatchObject({ text: 'Первая строка', authorUserId: 'tg:11' });
    expect(await db.discussionMessages.get(reply.id)).not.toHaveProperty('quote');
    await coach.edit(thread.id, original.id, 'Новая цитата');
    expect((await client.getMessage(thread.id, reply.id)).reply?.text).toBe('Новая цитата');
    const second = await coach.createThread(prepareDiscussionThread(anchor, 'Программа', '2026-11-06'));
    const invalid = prepareDiscussionMessage(second.id, 'Чужая ссылка', original.id);
    await expect(client.send(invalid)).rejects.toThrow('DISCUSSION_MESSAGE_NOT_FOUND');
    expect(await db.discussionMessages.get(invalid.id)).toBeUndefined();
    await coach.remove(thread.id, original.id);
    expect((await client.getMessage(thread.id, reply.id)).reply).toMatchObject({ text: '', deleted: true });
    expect((await db.discussionMessages.get(original.id))?.text).toBe('');
    await client.send(prepareDiscussionMessage(thread.id, 'Ответ удалённому', original.id));
  });
  it('rejects foreign author writes and isolates two trainers and personal history even with all test rows cached', async () => {
    const { db, coach, client, thread, scope, other, anchor } = await fixture();
    const own = await coach.send(prepareDiscussionMessage(thread.id, 'Текст тренера'));
    await expect(client.edit(thread.id, own.id, 'Подмена')).rejects.toThrow();
    await expect(client.remove(thread.id, own.id)).rejects.toThrow('DISCUSSION_ACCESS_DENIED');
    const foreign = new DiscussionRepository(db, 'tg:33', scope);
    await expect(foreign.page(thread.id)).rejects.toThrow('DISCUSSION_ACCESS_DENIED');
    const second = new DiscussionRepository(db, 'tg:33', { realmId: other.realm.realmId, coachClientId: other.realm.realmId });
    expect(await second.listThreads(anchor)).toEqual([]);
    await expect(second.getMessage(thread.id, own.id)).rejects.toThrow('DISCUSSION_NOT_FOUND');
    const personal = new DiscussionRepository(db, 'tg:22', { realmId: 'tg:22', coachClientId: null });
    expect(await personal.listThreads(anchor)).toEqual([]);
    const privateThread = await personal.createThread(prepareDiscussionThread(anchor, 'Личная программа', '2026-11-06'));
    await expect(coach.page(privateThread.id)).rejects.toThrow();
    expect((await coach.getMessage(thread.id, own.id)).text).toBe('Текст тренера');
  });
  it('counts unread per user/thread/anchor and paginates tied timestamps without skips', async () => {
    const { db, coach, client, thread, anchor } = await fixture();
    const createdAt = '2026-11-06T12:00:00.000Z';
    for (const id of ['a', 'b', 'c']) await coach.send({ id, threadId: thread.id, text: id, createdAt });
    await client.send({ id: 'd', threadId: thread.id, text: 'own', createdAt });
    const latest = await client.page(thread.id, undefined, 2);
    expect(latest.messages.map(row => row.id)).toEqual(['c', 'd']);
    expect((await client.page(thread.id, latest.before ?? undefined, 2)).messages.map(row => row.id)).toEqual(['a', 'b']);
    expect(await coach.unread(thread.id)).toBe(1); expect(await client.unread(thread.id)).toBe(3);
    await client.markRead(thread.id, 'b'); expect(await client.unread(thread.id)).toBe(1);
    await client.markRead(thread.id, 'a'); expect(await client.unread(thread.id)).toBe(1);
    await coach.remove(thread.id, 'c'); expect(await client.unread(thread.id)).toBe(0);
    const second = await coach.createThread(prepareDiscussionThread(anchor, 'Программа', '2026-11-06'));
    await coach.send(prepareDiscussionMessage(second.id, 'Новое'));
    expect(await client.unreadForAnchor(anchor)).toBe(1);
    expect(await db.discussionReadStates.count()).toBe(1);
  });
  it('shows the latest activity even when a cached thread hint lags a concurrent send', async () => {
    const { db, coach, thread, anchor } = await fixture();
    const createdAt = '2099-11-06T12:00:00.000Z';
    await coach.send({ ...prepareDiscussionMessage(thread.id, 'Latest'), createdAt });
    await db.discussionThreads.update(thread.id, { lastActivityAt: thread.createdAt });
    expect((await coach.listThreads(anchor))[0].lastActivityAt).toBe(createdAt);
    expect((await db.discussionThreads.get(thread.id))?.lastActivityAt).toBe(thread.createdAt);
  });
  it('validates malformed cached data and retains the attachment contract for active messages', async () => {
    const { db, coach, client, thread } = await fixture();
    const row = await coach.send(prepareDiscussionMessage(thread.id, 'Active'));
    const stored = await db.discussionMessages.get(row.id); if (!stored) throw Error('Missing row');
    expect(() => assertMessageAttachmentWrite('tg:11', thread, stored, {
      id: 'attachment', realmId: thread.realmId, messageId: row.id, owner: 'tg:11', authorUserId: 'tg:11',
      mediaType: 'photo', mimeType: 'image/jpeg', sizeBytes: 100, durationSeconds: null,
      storageKey: null, uploadState: 'pending', confirmedAt: null,
    })).not.toThrow();
    await client.markRead(thread.id, row.id);
    const state = (await db.discussionReadStates.toArray())[0];
    await db.discussionReadStates.update(state.id, { readThrough: 'malformed' });
    expect(await client.unread(thread.id)).toBe(1);
    await expect(client.markRead(thread.id, row.id)).rejects.toThrow('DISCUSSION_READ_STATE_REQUIRES_VALIDATION');
    await db.discussionMessages.update(row.id, { createdAt: 'malformed' });
    expect((await client.page(thread.id)).messages).toEqual([]);
  });
  it('does not regress the read watermark across two local connections', async () => {
    const { db, coach, client, scope, thread } = await fixture();
    for (const id of ['first', 'last']) await coach.send({ id, threadId: thread.id, text: id, createdAt: '2026-11-06T00:00:00.000Z' });
    const connection = new TestDatabase(db.name); await connection.open();
    const second = new DiscussionRepository(connection, 'tg:22', scope);
    await Promise.all([client.markRead(thread.id, 'last'), second.markRead(thread.id, 'first')]);
    expect(await client.unread(thread.id)).toBe(0); expect(await db.discussionReadStates.count()).toBe(1);
  });
  it('keeps detached anchor history and allows editing a reply when the original becomes unavailable', async () => {
    const { db, coach, client, thread, anchor } = await fixture();
    const original = await coach.send(prepareDiscussionMessage(thread.id, 'Original'));
    const reply = await client.send(prepareDiscussionMessage(thread.id, 'Reply', original.id));
    await db.discussionMessages.delete(original.id); // emulate an unavailable original, not normal application delete
    expect((await client.getMessage(thread.id, reply.id)).reply).toMatchObject({ text: '', unavailable: true });
    await client.edit(thread.id, reply.id, 'Updated reply');
    expect((await client.getMessage(thread.id, reply.id)).text).toBe('Updated reply');
    expect((await coach.listThreads(anchor))[0].anchor).toEqual(anchor);
    await client.remove(thread.id, reply.id);
    expect((await coach.getMessage(thread.id, reply.id)).deleted).toBe(true);
  });
  it('serializes local edit/delete and masks tombstones for all merged text values', async () => {
    const { db, coach, scope, thread } = await fixture();
    const id = (await coach.send(prepareDiscussionMessage(thread.id, 'Исходный текст'))).id;
    const connection = new TestDatabase(db.name); await connection.open();
    const second = new DiscussionRepository(connection, 'tg:11', scope);
    await Promise.allSettled([coach.edit(thread.id, id, 'Из другого окна'), second.remove(thread.id, id)]);
    expect(await coach.getMessage(thread.id, id)).toMatchObject({ text: '', deleted: true });
    await expect(coach.edit(thread.id, id, 'Вернуть')).rejects.toThrow('DISCUSSION_MESSAGE_DELETED');
    const tombstone = await db.discussionMessages.get(id); if (!tombstone) throw Error('Missing row');
    for (const text of ['', 'Исходный текст', 'Конкурентная правка']) {
      const merged = { ...tombstone, text };
      expect(discussionMessageView(merged).text).toBe('');
      expect(discussionMessageView({ ...merged, id: 'reply', text: 'ответ', deletedAt: '', replyToMessageId: id }, merged).reply?.text).toBe('');
    }
  });
  it('observes changes to quoted originals, reports query errors and releases subscriptions', async () => {
    const { coach, client, thread } = await fixture();
    const source = await coach.send({ ...prepareDiscussionMessage(thread.id, 'Оригинал'), createdAt: '2026-11-06T00:00:00.001Z' });
    await client.send({ ...prepareDiscussionMessage(thread.id, 'Ответ', source.id), createdAt: '2026-11-06T00:00:00.002Z' });
    const next = vi.fn(), error = vi.fn(); const sub = client.observePage(thread.id, next, error, undefined, 1);
    await vi.waitFor(() => expect(next).toHaveBeenCalled());
    await coach.remove(thread.id, source.id);
    await vi.waitFor(() => expect(next.mock.lastCall?.[0].messages.at(-1)?.reply?.text).toBe(''));
    sub.unsubscribe(); expect(error).not.toHaveBeenCalled();
    const bad = client.observePage('not-found', vi.fn(), error);
    await vi.waitFor(() => expect(error).toHaveBeenCalled()); bad.unsubscribe();
  });
  it('appends v16 indexes, preserves v15 records and registers the production discussion schema', async () => {
    const old = new TestDatabase(undefined, 15); await old.open();
    await old.discussionMessages.add({ id: 'preserved', realmId: 'tg:11', owner: 'tg:11', authorUserId: 'tg:11',
      threadId: 'thread', text: 'History', createdAt: '2026-11-06T00:00:00.000Z' });
    old.close(); const current = new TestDatabase(old.name); await current.open();
    expect((await current.discussionMessages.get('preserved'))?.text).toBe('History');
    expect(current.discussionReadStates.schema.indexes.map(index => index.name)).toContain('[id+readThrough]');
    expect(current.discussionReadStates.schema.indexes.map(index => index.name)).toContain('[id+lastReadAt]');
    const production = new MezfitCloudDatabase('99881', 'signed'); databases.push(production);
    expect(production.verno).toBe(CLOUD_DISCUSSION_DATABASE_VERSION);
    expect(production.tables.some(table => table.name === 'discussionMessages')).toBe(true);
  });
  it('derives receipt from the recipient watermark, and delivery only from an awaited push for exact IDs', async () => {
    const { db, coach, client, thread } = await fixture();
    const first = await coach.send(prepareDiscussionMessage(thread.id, 'Первое'));
    const second = await coach.send(prepareDiscussionMessage(thread.id, 'Второе'));
    const fromClient = await client.send(prepareDiscussionMessage(thread.id, 'От клиента'));
    const next = vi.fn(), error = vi.fn();
    const sub = coach.observeReceipts(thread.id, next, error);
    await vi.waitFor(() => expect(next).toHaveBeenCalled());
    expect(next.mock.lastCall?.[0]).toEqual({ confirmedIds: [], recipientReadThrough: [] });

    // Reading on the sender's device is not evidence that the recipient read.
    await coach.markRead(thread.id, fromClient.id);
    await vi.waitFor(() => expect(next.mock.lastCall?.[0].recipientReadThrough).toEqual([]));
    await client.markRead(thread.id, first.id);
    await vi.waitFor(() => expect(next.mock.lastCall?.[0].recipientReadThrough).toEqual([
      { id: first.id, createdAt: first.createdAt },
    ]));

    let release: () => void = () => {};
    const push = vi.spyOn(db.cloud, 'sync').mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    const confirming = coach.confirmDelivery(thread.id, [first.id, second.id, 'unknown']);
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith({ purpose: 'push', wait: true }));
    expect(next.mock.lastCall?.[0].confirmedIds).toEqual([]);
    release();
    await confirming;
    expect(next.mock.lastCall?.[0].confirmedIds).toEqual([first.id, second.id]);

    const state = (await db.discussionReadStates.toArray()).find(row => row.userId === client.actorUserId);
    if (!state) throw Error('Missing recipient watermark');
    await db.discussionReadStates.update(state.id, { readThrough: 'corrupt' });
    await vi.waitFor(() => expect(next.mock.lastCall?.[0].recipientReadThrough).toEqual([]));
    expect(error).not.toHaveBeenCalled();
    sub.unsubscribe();
    push.mockRestore();
  });
});


describe('COMM-06 canonical entity compatibility, local IndexedDB evidence only', () => {
  it('uses identical IDs across actors/devices/reopen and isolates another pair and occurrence', async () => {
    const { db, coach, client, scope, anchor, other } = await fixture();
    const secondConnection = new TestDatabase(db.name); await secondConnection.open();
    const device = new DiscussionRepository(secondConnection, client.actorUserId, scope);
    const [a, b] = await Promise.all([coach.ensureEntityThread(anchor, 'Программа'), device.ensureEntityThread(anchor, 'Другое имя')]);
    expect(a.id).toBe(b.id);
    expect(a.id).toBe(await entityDiscussionId(scope, anchor));
    expect((await client.ensureEntityThread(anchor, 'После переименования')).id).toBe(a.id);
    expect((await coach.listThreads(anchor)).filter(row => row.id === a.id)).toHaveLength(1);
    expect(await entityDiscussionId({ realmId: other.realm.realmId, coachClientId: other.realm.realmId }, anchor)).not.toBe(a.id);
    expect(await entityDiscussionId(scope, { kind: 'workout', workout: { kind: 'occurrence', id: 'program' } })).not.toBe(a.id);
    expect(await entityDiscussionId(scope, anchor)).toBe(await entityDiscussionId(scope, { trainingPlanId: 'program', kind: 'program' }));
  });
  it('merges legacy pages without copying, supports replies/edit/delete and rejects another anchor', async () => {
    const { db, coach, client, thread, anchor } = await fixture();
    const second = await coach.createThread(prepareDiscussionThread(anchor, 'Старая тема', '2026-11-06'));
    const first = await coach.send({ ...prepareDiscussionMessage(thread.id, 'История 1'), createdAt: '2026-11-06T10:00:00.000Z' });
    const last = await client.send({ ...prepareDiscussionMessage(second.id, 'История 2'), createdAt: '2026-11-06T11:00:00.000Z' });
    const canonical = await client.ensureEntityThread(anchor, 'Программа');
    expect((await client.page(canonical.id, undefined, 1)).messages.map(row => row.id)).toEqual([last.id]);
    const page = await client.page(canonical.id, undefined, 1);
    expect(page.before).toBeTruthy();
    expect((await client.page(canonical.id, page.before ?? undefined, 1)).messages.map(row => row.id)).toEqual([first.id]);
    const reply = await client.send(prepareDiscussionMessage(canonical.id, 'Ответ старому сообщению', first.id));
    expect(reply.reply).toMatchObject({ messageId: first.id, text: 'История 1' });
    await coach.edit(canonical.id, first.id, 'Исправленная история');
    expect((await client.getMessage(canonical.id, reply.id)).reply?.text).toBe('Исправленная история');
    await coach.remove(canonical.id, first.id);
    expect((await client.getMessage(canonical.id, reply.id)).reply).toMatchObject({ deleted: true, text: '' });
    expect((await db.discussionMessages.get(first.id))?.threadId).toBe(thread.id);
    expect(await db.discussionMessages.count()).toBe(3);
    const foreign = await coach.ensureEntityThread({ kind: 'program', trainingPlanId: 'other' }, 'Другая программа');
    await expect(coach.send(prepareDiscussionMessage(foreign.id, 'Чужой ответ', first.id))).rejects.toThrow('DISCUSSION_MESSAGE_NOT_FOUND');
  });
  it('observes a canonical single-message page quoting legacy history and propagates query errors', async () => {
    const { coach, client, thread, anchor } = await fixture();
    const source = await coach.send({ ...prepareDiscussionMessage(thread.id, 'За пределами страницы'), createdAt: '2026-11-06T00:00:00.001Z' });
    const canonical = await client.ensureEntityThread(anchor, 'Программа');
    await client.send({ ...prepareDiscussionMessage(canonical.id, 'Ответ на историю', source.id), createdAt: '2026-11-06T00:00:00.002Z' });
    const direct = await client.page(canonical.id, undefined, 1);
    expect(direct.messages[0].reply?.text).toBe('За пределами страницы');
    let subscription: { unsubscribe(): void } | undefined;
    try {
      const first = await new Promise<typeof direct>((resolve, reject) => {
        subscription = client.observePage(canonical.id, resolve, reject, undefined, 1);
      });
      expect(first.messages).toHaveLength(1);
      expect(first.messages[0].reply?.text).toBe('За пределами страницы');
    } finally { subscription?.unsubscribe(); }
  });
  it.each(['coach', 'client'] as const)('observes %s read-state updates from another connection without a push acknowledgement', async authorRole => {
    const { db, coach, client, anchor, scope } = await fixture();
    const author = authorRole === 'coach' ? coach : client;
    const readerId = authorRole === 'coach' ? client.actorUserId : coach.actorUserId;
    const canonical = await author.ensureEntityThread(anchor, 'Программа');
    const sent = await author.send(prepareDiscussionMessage(canonical.id, 'Прочитать на другом устройстве'));
    const connection = new TestDatabase(db.name); await connection.open();
    const reader = new DiscussionRepository(connection, readerId, scope);
    const snapshots: Array<{ confirmedIds: readonly string[]; recipientReadThrough: readonly { id: string; threadId?: string }[] }> = [];
    const failures: unknown[] = [];
    let subscription: { unsubscribe(): void } | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        subscription = author.observeReceipts(canonical.id, value => { snapshots.push(value); resolve(); },
          reason => { failures.push(reason); reject(reason); });
      });
      expect(snapshots.at(-1)?.recipientReadThrough).toEqual([]);
      await reader.markRead(canonical.id, sent.id);
      await vi.waitFor(() => expect(snapshots.at(-1)?.recipientReadThrough).toEqual([
        { id: sent.id, createdAt: sent.createdAt, threadId: canonical.id },
      ]));
      expect(snapshots.at(-1)?.confirmedIds).toEqual([]);
      expect(failures).toEqual([]);
      expect(await reader.unread(canonical.id)).toBe(0);
    } finally { subscription?.unsubscribe(); }
  });
  it.each(['coach', 'client'] as const)('observes authored read evidence for %s and upgrades an unindexed legacy cursor without moving backward', async sender => {
    const { db, coach, client, thread, anchor } = await fixture();
    const author = sender === 'coach' ? coach : client, reader = sender === 'coach' ? client : coach;
    const old = await author.send({ ...prepareDiscussionMessage(thread.id, 'Старое'), createdAt: '2026-11-06T10:00:00.000Z' });
    await reader.markRead(thread.id, old.id);
    const state = (await db.discussionReadStates.toArray())[0];
    await db.discussionReadStates.update(state.id, { readThrough: undefined });
    const canonical = await reader.ensureEntityThread(anchor, 'Программа');
    const latest = await author.send({ ...prepareDiscussionMessage(canonical.id, 'Новое'), createdAt: '2026-11-06T11:00:00.000Z' });
    const receipts = vi.fn(), errors = vi.fn();
    const sub = author.observeReceipts(canonical.id, receipts, errors);
    await reader.markRead(canonical.id, latest.id);
    await vi.waitFor(() => expect(receipts.mock.lastCall?.[0].recipientReadThrough).toEqual(expect.arrayContaining([
      { id: old.id, createdAt: old.createdAt, threadId: thread.id },
      { id: latest.id, createdAt: latest.createdAt, threadId: canonical.id },
    ])));
    expect(await reader.unreadForAnchor(anchor)).toBe(0);
    await reader.markRead(canonical.id, old.id);
    expect(await reader.unread(canonical.id)).toBe(0);
    expect((await db.discussionReadStates.get(state.id))?.readThrough).toBe(old.createdAt + '/' + old.id);
    expect(errors).not.toHaveBeenCalled(); sub.unsubscribe();
  });
});
