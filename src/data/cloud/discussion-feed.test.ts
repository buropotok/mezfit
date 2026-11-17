// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import dexieCloud from 'dexie-cloud-addon';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import { CLOUD_DATABASE_STORES_V17, type MezfitCloudDatabase } from './database';
import { DiscussionSession } from '../../discussions/discussion-session';
import { DiscussionRepository, prepareDiscussionMessage, prepareDiscussionThread, prepareFreeDiscussion,
  readDiscussionNotificationThread } from './discussions';

class FeedDatabase extends Dexie {
  declare discussionThreads: MezfitCloudDatabase['discussionThreads'];
  declare discussionMessages: MezfitCloudDatabase['discussionMessages'];
  declare discussionReadStates: MezfitCloudDatabase['discussionReadStates'];
  declare messageAttachments: MezfitCloudDatabase['messageAttachments'];
  constructor() {
    super('discussion-feed-' + crypto.randomUUID(), { addons: [dexieCloud] });
    this.version(17).stores(CLOUD_DATABASE_STORES_V17);
    this.cloud.configure({ databaseUrl: '', requireAuth: false, disableEagerSync: true,
      disableWebSocket: true, tryUseServiceWorker: false });
    databases.push(this);
  }
}
const databases: FeedDatabase[] = [];
afterEach(async () => { for (const db of databases.splice(0)) { db.close(); await db.delete(); } });
async function fixture() {
  const db = new FeedDatabase(); await db.open();
  const pairs = await Promise.all([relationshipMembership('11', '22'), relationshipMembership('11', '44'), relationshipMembership('33', '22')]);
  await new Promise<void>((resolve, reject) => {
    const tx = db.backendDB().transaction(['realms', 'members'], 'readwrite');
    for (const pair of pairs) {
      tx.objectStore('realms').put(pair.realm);
      for (const member of pair.members) tx.objectStore('members').put(member);
    }
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
  });
  const scope = (index: number) => ({ realmId: pairs[index].realm.realmId, coachClientId: pairs[index].realm.realmId });
  return { db, scope, coach: new DiscussionRepository(db, 'tg:11', scope(0)), client: new DiscussionRepository(db, 'tg:22', scope(0)) };
}
const anchor = { kind: 'program' as const, trainingPlanId: 'same-program-id' };
const time = '2026-11-07T10:00:00.000Z';

describe('COMM-08 local feed projection', () => {
  it('isolates two clients and two coaches even with equal anchor IDs; denies an unrelated actor', async () => {
    const { db, scope, coach, client } = await fixture();
    const otherClient = new DiscussionRepository(db, 'tg:11', scope(1));
    const otherCoach = new DiscussionRepository(db, 'tg:33', scope(2));
    for (const repo of [coach, otherClient, otherCoach]) {
      const thread = await repo.ensureEntityThread(anchor, repo.actorUserId);
      await repo.send({ id: crypto.randomUUID(), threadId: thread.id, text: repo.actorUserId, createdAt: time });
    }
    expect((await client.feed(db)).map(row => row.latest?.text)).toEqual(['tg:11']);
    expect((await new DiscussionRepository(db, 'tg:22', scope(2)).feed(db)).map(row => row.latest?.text)).toEqual(['tg:33']);
    expect((await otherClient.feed(db))[0].thread.realmId).toBe(scope(1).realmId);
    await expect(new DiscussionRepository(db, 'tg:44', scope(0)).feed(db)).rejects.toThrow('DISCUSSION_ACCESS_DENIED');
  });
  it('shows one conversation for legacy headers, sums unread once and follows edit/delete/read without creating rows', async () => {
    const { db, coach, client } = await fixture();
    const old = await coach.createThread(prepareDiscussionThread(anchor, 'Старый заголовок', '2026-11-06'));
    const second = await coach.createThread(prepareDiscussionThread(anchor, 'Другой заголовок', '2026-11-06'));
    await coach.send({ id: 'a', threadId: old.id, text: 'Первый', createdAt: time });
    await coach.send({ id: 'b', threadId: second.id, text: 'Последний', createdAt: '2026-11-07T11:00:00.000Z' });
    await coach.saveDraft({ id: 'private-draft', threadId: old.id, text: 'Не отправлен', createdAt: '2026-11-07T12:00:00.000Z' });
    expect(await db.discussionThreads.count()).toBe(2);
    expect(await client.feed(db)).toMatchObject([{ latest: { id: 'b', text: 'Последний' }, unread: 2 }]);
    expect(await db.discussionThreads.count()).toBe(2);
    const canonical = await coach.ensureEntityThread(anchor, 'Программа');
    expect(await client.feed(db)).toMatchObject([{ thread: { id: canonical.id }, unread: 2 }]);
    expect(await client.feed(undefined, false)).toMatchObject([{ thread: { id: canonical.id }, latest: null, unread: 2 }]);
    await coach.edit(canonical.id, 'b', 'Исправленный текст');
    expect((await client.feed(db))[0].latest?.text).toBe('Исправленный текст');
    await coach.remove(canonical.id, 'b');
    expect(await client.feed(db)).toMatchObject([{ latest: { id: 'a', text: 'Первый' }, unread: 1 }]);
    await client.markRead(canonical.id, 'a');
    expect((await client.feed(db))[0].unread).toBe(0);
    await coach.remove(canonical.id, 'a');
    expect((await client.feed(db))[0].latest).toBeNull();
  });
  it('advertises only valid ready attachments on undeleted messages in the same realm', async () => {
    const { db, coach, client, scope } = await fixture();
    const thread = await coach.ensureEntityThread(anchor, 'Программа');
    await coach.send({ id: 'message', threadId: thread.id, text: 'Файл', createdAt: time });
    await db.messageAttachments.add({ id: 'file', realmId: scope(0).realmId, messageId: 'message', owner: 'tg:11', authorUserId: 'tg:11',
      mediaType: 'photo', storageKey: 'private/file.jpg', mimeType: 'image/jpeg', sizeBytes: 100, durationSeconds: null,
      uploadState: 'ready', confirmedAt: time });
    // Replication/old data can omit a lookup key. It must be rejected before
    // bulkGet, rather than taking down the valid file and the whole inbox.
    await new Promise<void>((resolve, reject) => {
      const tx = db.backendDB().transaction(['messageAttachments'], 'readwrite');
      tx.objectStore('messageAttachments').put({ id: 'broken-file', realmId: scope(0).realmId, uploadState: 'ready' });
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    });
    expect((await client.feed(db))[0].hasAttachments).toBe(true);
    await db.messageAttachments.update('file', { deletedAt: time });
    expect((await client.feed(db))[0].hasAttachments).toBe(false);
    await db.messageAttachments.update('file', { deletedAt: undefined, realmId: scope(1).realmId });
    expect((await client.feed(db))[0].hasAttachments).toBe(false);
    await db.messageAttachments.update('file', { realmId: scope(0).realmId });
    await coach.remove(thread.id, 'message');
    expect((await client.feed(db))[0].hasAttachments).toBe(false);
  });
});

describe('free discussions in the local repository', () => {
  it('creates one thread per command and refuses conflicting repetitions and unauthorised scopes', async () => {
    const { db, scope, coach, client } = await fixture();
    const input = prepareFreeDiscussion('  Питание  ');
    const [first, repeated] = await Promise.all([coach.createFreeDiscussion(input), client.createFreeDiscussion(input)]);
    expect(first).toEqual(repeated);
    expect(first).toMatchObject({ id: input.id, derivedTitleSnapshot: 'Питание', contextPath: [],
      anchor: { kind: 'free', threadId: input.id } });
    expect(await db.discussionThreads.count()).toBe(1);
    await expect(coach.createFreeDiscussion({ ...input, title: 'Техника' })).rejects.toThrow('DISCUSSION_ID_REUSED');
    await expect(coach.createFreeDiscussion({ ...input, createdAt: time })).rejects.toThrow('DISCUSSION_ID_REUSED');
    await expect(new DiscussionRepository(db, 'tg:11', scope(1)).createFreeDiscussion(input)).rejects.toThrow('DISCUSSION_ID_REUSED');
    await expect(new DiscussionRepository(db, 'tg:44', scope(0)).createFreeDiscussion(input)).rejects.toThrow('DISCUSSION_ACCESS_DENIED');
    await expect(new DiscussionRepository(db, 'tg:11', { realmId: 'tg:11', coachClientId: null })
      .createFreeDiscussion(input)).rejects.toThrow('DISCUSSION_ACCESS_DENIED');
    await expect(coach.ensureEntityThread(first.anchor, 'Питание')).rejects.toThrow('INVALID_DISCUSSION_ANCHOR');
    await expect(coach.createFreeDiscussion({ ...input, id: 'plain-id' })).rejects.toThrow('INVALID_DISCUSSION_ANCHOR');
    await expect(new DiscussionRepository(db, 'tg:11', scope(1)).getThread(first.id)).rejects.toThrow('DISCUSSION_NOT_FOUND');
  });

  it('opens same-title threads separately, including an empty chat, and resolves the exact notification', async () => {
    const { db, scope, coach, client } = await fixture();
    const first = await coach.createFreeDiscussion(prepareFreeDiscussion('Питание'));
    const second = await client.createFreeDiscussion(prepareFreeDiscussion('Питание'));
    expect(first.anchorKey).not.toBe(second.anchorKey);
    expect(await client.feed()).toEqual(expect.arrayContaining([
      { thread: first, latest: null, unread: 0, hasAttachments: false },
      { thread: second, latest: null, unread: 0, hasAttachments: false },
    ]));
    const firstMessage = await coach.send({ id: 'first-message', threadId: first.id, text: 'Первая ветка', createdAt: time });
    const secondMessage = await coach.send({ id: 'second-message', threadId: second.id, text: 'Вторая ветка', createdAt: time });
    const session = new DiscussionSession(client, { threadId: second.id, anchor: second.anchor });
    session.start();
    try {
      await vi.waitFor(() => expect(session.snapshot()).toMatchObject({
        title: 'Питание', loading: false, messages: [secondMessage],
      }));
      expect(await session.locate(secondMessage.id)).toBe(true);
      await expect(session.locate(firstMessage.id)).rejects.toThrow('DISCUSSION_MESSAGE_NOT_FOUND');
      await client.markRead(second.id, secondMessage.id);
      expect(await client.unread(second.id)).toBe(0);
      expect(await client.unread(first.id)).toBe(1);
      await expect(readDiscussionNotificationThread(db, client.actorUserId, secondMessage.id, new Set([scope(0).realmId])))
        .resolves.toMatchObject({ id: second.id });
      await expect(readDiscussionNotificationThread(db, 'tg:44', secondMessage.id, new Set([scope(0).realmId])))
        .rejects.toThrow('DISCUSSION_ACCESS_DENIED');
    } finally {
      session.stop();
    }
  });
});

it('projects an attachment from a free chat after local hydration on another device', async () => {
  const source = await fixture();
  const target = await fixture();
  const thread = await source.coach.createFreeDiscussion(prepareFreeDiscussion('Разбор техники'));
  const storageKey = 'mvp-media/' + 'c'.repeat(64);
  const command = { ...prepareDiscussionMessage(thread.id, ''), draftMedia: {
    id: 'free-photo', storageKey, mediaType: 'photo' as const, mimeType: 'image/jpeg',
    sizeBytes: 128, durationSeconds: null, fileName: 'photo.jpg', uploadState: 'uploading' as const,
  } };
  await source.coach.saveDraft(command);
  const sent = await source.coach.send(command, { key: storageKey,
    url: 'https://example.com/photo.jpg', contentType: 'image/jpeg', sizeBytes: 128, fileName: 'photo.jpg' });
  const message = await source.db.discussionMessages.get(sent.id);
  const attachment = await source.db.messageAttachments.get(command.draftMedia.id);
  if (!message || !attachment) throw new Error('Missing published message or attachment');

  // Seed as if the Addon hydrated an independently opened IndexedDB.
  await new Promise<void>((resolve, reject) => {
    const tx = target.db.backendDB().transaction(['discussionThreads', 'discussionMessages', 'messageAttachments'], 'readwrite');
    tx.objectStore('discussionThreads').put(thread);
    tx.objectStore('discussionMessages').put(message);
    tx.objectStore('messageAttachments').put(attachment);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  expect(await target.client.feed(target.db)).toMatchObject([{ thread: { id: thread.id }, hasAttachments: true, unread: 1 }]);
  expect((await target.client.page(thread.id)).messages).toMatchObject([
    { id: sent.id, attachments: [{ id: attachment.id, mediaType: 'photo' }] },
  ]);
});
