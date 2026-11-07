// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie, { type Table } from 'dexie';
import dexieCloud from 'dexie-cloud-addon';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import { CLOUD_DATABASE_STORES_V15, CLOUD_DATABASE_STORES_V16 } from './database';
import { DiscussionRepository, prepareDiscussionMessage, prepareDiscussionThread } from './discussions';
import { type DiscussionMessage, type DiscussionThread, type DiscussionReadState } from './discussion-contracts';
class TestDatabase extends Dexie {
  declare discussionThreads: Table<DiscussionThread, string>;
  declare discussionMessages: Table<DiscussionMessage, string>;
  declare discussionReadStates: Table<DiscussionReadState, string>;
  constructor(name = 'discussions-' + crypto.randomUUID(), version = 16) {
    super(name, { addons: [dexieCloud] });
    this.version(15).stores(CLOUD_DATABASE_STORES_V15);
    if (version === 16) this.version(16).stores(CLOUD_DATABASE_STORES_V16);
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

describe('private draft recovery and first publication', () => {
  it('recovers the author draft by thread without an external ID and isolates other authors/threads', async () => {
    const { coach, client, thread, anchor } = await fixture();
    const other = await coach.createThread(prepareDiscussionThread(anchor, 'Other', '2026-11-06'));
    const input = prepareDiscussionMessage(thread.id, 'Private recovery');
    await coach.saveDraft(input);
    await coach.saveDraft(prepareDiscussionMessage(other.id, 'Other thread'));
    expect(await coach.getDraft(thread.id)).toEqual(input);
    expect(await client.getDraft(thread.id)).toBeNull();
    expect((await client.page(thread.id)).messages).toEqual([]);
    await coach.send(input);
    expect(await coach.getDraft(thread.id)).toBeNull();
  });
  it('publishes an old draft above the read watermark and freezes send time/ID across retries', async () => {
    const { db, coach, client, thread, scope } = await fixture();
    const input = { ...prepareDiscussionMessage(thread.id, 'Old draft'),
      createdAt: new Date(Date.now() - 3600000).toISOString() };
    await coach.saveDraft(input);
    const read = await coach.send({ ...prepareDiscussionMessage(thread.id, 'Already read'),
      createdAt: new Date(Date.now() - 60000).toISOString() });
    await client.markRead(thread.id, read.id);
    expect(await client.unread(thread.id)).toBe(0);
    db.close(); await db.open();
    const reopened = new DiscussionRepository(db, coach.actorUserId, scope);
    const recovered = await reopened.getDraft(thread.id);
    expect(recovered?.id).toBe(input.id);
    if (!recovered) throw Error('Missing draft');
    const earliest = Date.now(), sent = await reopened.send(recovered);
    expect(sent.id).toBe(input.id);
    expect(Date.parse(sent.createdAt)).toBeGreaterThanOrEqual(earliest);
    expect(await client.unread(thread.id)).toBe(1);
    expect((await client.page(thread.id)).messages.at(-1)?.id).toBe(input.id);
    await reopened.edit(thread.id, input.id, 'Edited after send');
    expect(await reopened.send(recovered)).toMatchObject({ id: input.id, createdAt: sent.createdAt, text: 'Edited after send' });
    await reopened.remove(thread.id, input.id);
    expect(await reopened.send(recovered)).toMatchObject({ id: input.id, createdAt: sent.createdAt, deleted: true, text: '' });
    expect(await reopened.getDraft(thread.id)).toBeNull();
  });
  it('never acknowledges another device publication as a strict composer send', async () => {
    const { db, coach, thread, scope } = await fixture();
    const original = prepareDiscussionMessage(thread.id, 'Published by device one');
    await coach.saveDraft(original);
    const second = new DiscussionRepository(db, coach.actorUserId, scope);
    const recovered = await second.getDraft(thread.id);
    if (!recovered) throw Error('Missing synchronized draft');
    await coach.send(original);
    const changed = { ...recovered, text: 'New text on device two', requireUnsentDraft: true as const };
    await expect(second.saveDraft(changed)).rejects.toThrow('DISCUSSION_ID_REUSED');
    await expect(second.send(changed)).rejects.toThrow('DISCUSSION_DRAFT_ALREADY_PUBLISHED');
    expect((await second.getMessage(thread.id, original.id)).text).toBe(original.text);
    // A new local draft preserves the second device's intent without editing the publication.
    const replacement = prepareDiscussionMessage(thread.id, changed.text);
    await second.saveDraft(replacement);
    const sent = await second.send({ ...replacement, requireUnsentDraft: true });
    expect(sent).toMatchObject({ id: replacement.id, text: changed.text });
    expect((await second.page(thread.id)).messages).toHaveLength(2);
  });
  it('guards publication even if the draft was sent between local save and submit, while ordinary retries stay idempotent', async () => {
    const { coach, thread } = await fixture();
    const input = prepareDiscussionMessage(thread.id, 'Initial publication');
    await expect(coach.send({ ...input, requireUnsentDraft: true })).rejects.toThrow('DISCUSSION_DRAFT_NOT_SAVED');
    await coach.saveDraft(input);
    const sent = await coach.send({ ...input, requireUnsentDraft: true });
    await expect(coach.send({ ...input, requireUnsentDraft: true })).rejects.toThrow('DISCUSSION_DRAFT_ALREADY_PUBLISHED');
    await coach.edit(thread.id, input.id, 'Later edit');
    expect(await coach.send(input)).toMatchObject({ id: input.id, createdAt: sent.createdAt, text: 'Later edit' });
    await coach.remove(thread.id, input.id);
    await expect(coach.send({ ...input, requireUnsentDraft: true })).rejects.toThrow('DISCUSSION_DRAFT_ALREADY_PUBLISHED');
    expect(await coach.send(input)).toMatchObject({ deleted: true, text: '' });
  });

});
