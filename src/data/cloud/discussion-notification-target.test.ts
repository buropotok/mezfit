// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie, { type Table } from 'dexie';
import dexieCloud from 'dexie-cloud-addon';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import { CLOUD_DATABASE_STORES_V17 } from './database';
import { type DiscussionMessage, type DiscussionReadState, type DiscussionThread } from './discussion-contracts';
import { DiscussionRepository, observeDiscussionNotificationThread, prepareDiscussionMessage,
  prepareDiscussionThread, readDiscussionNotificationThread } from './discussions';

const databases: TestDatabase[] = [];
class TestDatabase extends Dexie {
  declare discussionThreads: Table<DiscussionThread, string>;
  declare discussionMessages: Table<DiscussionMessage, string>;
  declare discussionReadStates: Table<DiscussionReadState, string>;
  constructor() {
    super('discussion-notification-target-' + crypto.randomUUID(), { addons: [dexieCloud] });
    this.version(17).stores(CLOUD_DATABASE_STORES_V17);
    this.cloud.configure({ databaseUrl: '', requireAuth: false, disableEagerSync: true,
      disableWebSocket: true, tryUseServiceWorker: false, unsyncedTables: ['localWorkoutOccurrenceDrafts'] });
    databases.push(this);
  }
}

async function seed(db: TestDatabase, table: string, rows: readonly unknown[]) {
  await new Promise<void>((resolve, reject) => {
    const transaction = db.backendDB().transaction(table, 'readwrite');
    for (const row of rows) transaction.objectStore(table).put(row);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
}

async function fixture() {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('Unexpected network'))));
  const db = new TestDatabase();
  await db.open();
  const pair = await relationshipMembership('11', '22');
  await seed(db, 'realms', [pair.realm]);
  await seed(db, 'members', pair.members);
  const scope = { realmId: pair.realm.realmId, coachClientId: pair.realm.realmId };
  const coach = new DiscussionRepository(db, 'tg:11', scope);
  const client = new DiscussionRepository(db, 'tg:22', scope);
  const thread = await client.createThread(prepareDiscussionThread(
    { kind: 'program', trainingPlanId: 'notification-test-plan' }, 'Программа', '2026-11-13'));
  return { db, coach, client, scope, thread };
}

afterEach(async () => {
  for (const db of databases.splice(0)) {
    db.close();
    await db.delete();
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('notification target lookup uses local, authorized message identity', () => {
  it('opens an existing target without hydrating media, quotes or a full message view', async () => {
    const { db, client, scope, thread } = await fixture();
    const sent = await client.send(prepareDiscussionMessage(thread.id, 'Сообщение из уведомления'));
    const richRead = vi.spyOn(DiscussionRepository.prototype, 'getMessage')
      .mockRejectedValue(new Error('Rich message projection temporarily failed'));
    const found = await readDiscussionNotificationThread(db, 'tg:11', sent.id, new Set([scope.realmId]));
    expect(found?.id).toBe(thread.id);
    expect(richRead).not.toHaveBeenCalled();
  });

  it('observes a missing message until it arrives, even with already-synchronized threads', async () => {
    const { db, client, scope, thread } = await fixture();
    const input = prepareDiscussionMessage(thread.id, 'Поздняя доставка');
    const results: Array<string | null> = [];
    const errors = vi.fn();
    const subscription = observeDiscussionNotificationThread(
      db, 'tg:11', input.id, new Set([scope.realmId]),
      value => results.push(value?.id ?? null), errors,
    );
    try {
      await vi.waitFor(() => expect(results.at(-1)).toBeNull());
      await client.send(input);
      await vi.waitFor(() => expect(results.at(-1)).toBe(thread.id));
      expect(errors).not.toHaveBeenCalled();
    } finally {
      subscription.unsubscribe();
    }
  });

  it('does not open messages outside the authenticated relationship', async () => {
    const { db, client, scope, thread } = await fixture();
    const sent = await client.send(prepareDiscussionMessage(thread.id, 'Частный чат'));
    expect(await readDiscussionNotificationThread(db, 'tg:11', sent.id, new Set(['other-realm']))).toBeNull();
    await expect(readDiscussionNotificationThread(db, 'tg:33', sent.id, new Set([scope.realmId])))
      .rejects.toThrow('DISCUSSION_ACCESS_DENIED');
    expect(await readDiscussionNotificationThread(db, 'tg:11', 'missing-message', new Set([scope.realmId])))
      .toBeNull();
  });
});
