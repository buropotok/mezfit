// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie, { type Table } from 'dexie';
import dexieCloud from 'dexie-cloud-addon';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import { CLOUD_DATABASE_STORES_V17 } from './database';
import { discussionReadStateId, matchesDiscussionReadStateId,
  type DiscussionThread, type DiscussionMessage, type DiscussionReadState } from './discussion-contracts';
import { summarizeDiscussionReads } from './discussion-read-diagnostics';
import { discussionCursorKey, discussionReadCursor, type DiscussionReceiptSnapshot } from './discussion-views';
import { DiscussionRepository, prepareDiscussionMessage, prepareDiscussionThread } from './discussions';

const databases: Dexie[] = [];
class ReadTestDatabase extends Dexie {
  declare discussionThreads: Table<DiscussionThread, string>;
  declare discussionMessages: Table<DiscussionMessage, string>;
  declare discussionReadStates: Table<DiscussionReadState, string>;
  constructor(name = 'discussion-read-transport-' + crypto.randomUUID()) {
    super(name, { addons: [dexieCloud] });
    this.version(17).stores(CLOUD_DATABASE_STORES_V17);
    this.cloud.configure({ databaseUrl: '', requireAuth: false, disableEagerSync: true,
      disableWebSocket: true, tryUseServiceWorker: false, unsyncedTables: ['localWorkoutOccurrenceDrafts'] });
    databases.push(this);
  }
}
afterEach(async () => {
  for (const db of databases) db.close();
  for (const db of new Map(databases.splice(0).map(db => [db.name, db])).values()) await db.delete();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function seed(db: Dexie, table: string, rows: readonly unknown[]) {
  // Emulate rows installed by the Addon, including its inbound array-key shape.
  await new Promise<void>((resolve, reject) => {
    const tx = db.backendDB().transaction(table, 'readwrite');
    for (const row of rows) tx.objectStore(table).put(row);
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
  });
}
async function fixture() {
  const fetch = vi.fn(() => Promise.reject(new Error('Unexpected network')));
  vi.stubGlobal('fetch', fetch);
  const db = new ReadTestDatabase(); await db.open();
  const pair = await relationshipMembership('11', '22');
  await seed(db, 'realms', [pair.realm]); await seed(db, 'members', pair.members);
  const scope = { realmId: pair.realm.realmId, coachClientId: pair.realm.realmId };
  const coach = new DiscussionRepository(db, 'tg:11', scope);
  const client = new DiscussionRepository(db, 'tg:22', scope);
  const anchor = { kind: 'program' as const, trainingPlanId: 'program' };
  const thread = await coach.createThread(prepareDiscussionThread(anchor, 'Программа', '2026-11-07'));
  return { db, scope, coach, client, thread, anchor, fetch };
}
function legacyState(message: DiscussionMessage, userId: string, decoded: boolean) {
  const key = ['discussion-read', message.realmId, message.threadId, userId];
  return { id: decoded ? key : JSON.stringify(key), realmId: message.realmId, threadId: message.threadId,
    userId, owner: userId, lastReadMessageId: message.id, lastReadAt: message.createdAt,
    readThrough: discussionCursorKey(message) };
}

describe('read-state IDs after Addon 4.4.15 inbound key decoding (local fixtures, not live cloud)', () => {
  it('uses an unambiguous deterministic string for new writes and matches only exact legacy identities', () => {
    const id = discussionReadStateId('realm', 'thread', 'tg:22');
    expect(id).toBe(discussionReadStateId('realm', 'thread', 'tg:22'));
    expect(['[', '#']).not.toContain(id[0]);
    const tuple = ['discussion-read', 'realm', 'thread', 'tg:22'];
    for (const key of [id, tuple, JSON.stringify(tuple)]) {
      expect(matchesDiscussionReadStateId(key, 'realm', 'thread', 'tg:22')).toBe(true);
      expect(matchesDiscussionReadStateId(key, 'other', 'thread', 'tg:22')).toBe(false);
      expect(matchesDiscussionReadStateId(key, 'realm', 'other', 'tg:22')).toBe(false);
      expect(matchesDiscussionReadStateId(key, 'realm', 'thread', 'tg:11')).toBe(false);
    }
    for (const key of [null, {}, new Array(4), ['wrong', 'realm', 'thread', 'tg:22'], [...tuple, 'extra'], JSON.stringify(tuple) + ' ']) {
      expect(matchesDiscussionReadStateId(key, 'realm', 'thread', 'tg:22')).toBe(false);
    }
  });

  it.each(['coach', 'client'] as const)('accepts decoded legacy evidence for %s without reading/opening on the sender', async role => {
    const { db, coach, client, thread, anchor, fetch } = await fixture();
    const author = role === 'coach' ? coach : client, reader = role === 'coach' ? client : coach;
    const sent = await author.send(prepareDiscussionMessage(thread.id, 'Уже прочитано'));
    const stored = await db.discussionMessages.get(sent.id); if (!stored) throw Error('Missing message');
    const legacy = legacyState(stored, reader.actorUserId, true);
    await seed(db, 'discussionReadStates', [legacy]);
    const canonical = await author.ensureEntityThread(anchor, 'Программа');
    const snapshots: DiscussionReceiptSnapshot[] = [];
    const errors = vi.fn();
    const sub = author.observeReceipts(canonical.id, value => snapshots.push(value), errors);
    try {
      await vi.waitFor(() => expect(snapshots.at(-1)?.recipientReadThrough).toContainEqual({
        id: sent.id, createdAt: sent.createdAt, threadId: thread.id,
      }));
      expect(snapshots.at(-1)?.confirmedIds).toEqual([]);
      expect(await reader.unread(canonical.id)).toBe(0);
      expect(errors).not.toHaveBeenCalled();
      expect(await db.discussionMessages.count()).toBe(1);
      expect(await db.discussionReadStates.count()).toBe(1);
      expect(fetch).not.toHaveBeenCalled();
    } finally { sub.unsubscribe(); }
  });

  it('keeps the highest legacy watermark on another connection while safe writes advance offline', async () => {
    const { db, coach, client, thread, scope, fetch } = await fixture();
    const first = await coach.send({ ...prepareDiscussionMessage(thread.id, 'Первое'), createdAt: '2026-11-07T09:00:00.000Z' });
    const second = await coach.send({ ...prepareDiscussionMessage(thread.id, 'Второе'), createdAt: '2026-11-07T09:01:00.000Z' });
    const stored = await db.discussionMessages.get(second.id); if (!stored) throw Error('Missing message');
    const legacy = legacyState(stored, client.actorUserId, true);
    await seed(db, 'discussionReadStates', [legacy]);
    const connection = new ReadTestDatabase(db.name); await connection.open();
    const otherDevice = new DiscussionRepository(connection, client.actorUserId, scope);
    await otherDevice.markRead(thread.id, first.id);
    expect(await client.unread(thread.id)).toBe(0);
    expect(await otherDevice.unread(thread.id)).toBe(0);
    const third = await coach.send({ ...prepareDiscussionMessage(thread.id, 'Третье'), createdAt: '2026-11-07T09:02:00.000Z' });
    expect(await otherDevice.unread(thread.id)).toBe(1);
    await otherDevice.markRead(thread.id, third.id);
    await client.markRead(thread.id, first.id);
    expect(await client.unread(thread.id)).toBe(0);
    const safe = await db.discussionReadStates.get(discussionReadStateId(scope.realmId, thread.id, client.actorUserId));
    expect(safe?.lastReadMessageId).toBe(third.id);
    expect(await db.discussionMessages.count()).toBe(3);
    expect(await db.discussionReadStates.count()).toBe(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts old string and decoded keys in the diagnostic without weakening owner or cursor checks', () => {
    const message: DiscussionMessage = { id: 'm', realmId: 'r', threadId: 't', owner: 'tg:11',
      authorUserId: 'tg:11', text: '', createdAt: '2026-11-07T09:00:00.000Z' };
    for (const decoded of [false, true]) {
      const state = legacyState(message, 'tg:22', decoded);
      expect(discussionReadCursor(state, 'r', 't', 'tg:22')).toEqual({ createdAt: message.createdAt, id: 'm' });
      expect(discussionReadCursor({ ...state, owner: 'tg:11' }, 'r', 't', 'tg:22')).toBeNull();
      expect(discussionReadCursor({ ...state, lastReadMessageId: 'other' }, 'r', 't', 'tg:22')).toBeNull();
      expect(discussionReadCursor({ ...state, readThrough: 'invalid' }, 'r', 't', 'tg:22')).toBeNull();
      const report = summarizeDiscussionReads('tg:11', [], [], [state], true);
      expect(report.rejected.identity).toBe(0);
      expect(report.rejected.threadOrRealm).toBe(1);
    }
  });
});
