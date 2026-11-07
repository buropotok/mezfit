// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie, { type Table } from 'dexie';
import dexieCloud from 'dexie-cloud-addon';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import { CLOUD_DATABASE_STORES_V16 } from './database';
import type { DiscussionMessage, DiscussionReadState, DiscussionThread } from './discussion-contracts';
import { DiscussionRepository, prepareDiscussionMessage, prepareDiscussionThread } from './discussions';

const databases: Dexie[] = [];
class EntityDatabase extends Dexie {
  declare discussionThreads: Table<DiscussionThread, string>;
  declare discussionMessages: Table<DiscussionMessage, string>;
  declare discussionReadStates: Table<DiscussionReadState, string>;
  constructor() {
    super('entity-discussions-' + crypto.randomUUID(), { addons: [dexieCloud] });
    this.version(16).stores(CLOUD_DATABASE_STORES_V16);
    this.cloud.configure({ databaseUrl: '', requireAuth: false, disableEagerSync: true,
      disableWebSocket: true, tryUseServiceWorker: false, unsyncedTables: ['localWorkoutOccurrenceDrafts'] });
    databases.push(this);
  }
}
afterEach(async () => {
  for (const db of databases.splice(0)) { db.close(); await db.delete(); }
  vi.unstubAllGlobals();
});

describe('COMM-06 entity history and indexed unread; local tests, not live server ACL evidence', () => {
  it('isolates two trainers, program roots, occurrences and personal history and retains snapshots without a live program', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(Error('Unexpected HTTP'))));
    const db = new EntityDatabase(); await db.open();
    const a = await relationshipMembership('11', '22'), b = await relationshipMembership('33', '22');
    await new Promise<void>((resolve, reject) => {
      const tx = db.backendDB().transaction(['realms', 'members'], 'readwrite');
      for (const pair of [a, b]) {
        tx.objectStore('realms').put(pair.realm);
        for (const member of pair.members) tx.objectStore('members').put(member);
      }
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    });
    const scopeA = { realmId: a.realm.realmId, coachClientId: a.realm.realmId };
    const scopeB = { realmId: b.realm.realmId, coachClientId: b.realm.realmId };
    const coach = new DiscussionRepository(db, 'tg:11', scopeA);
    const client = new DiscussionRepository(db, 'tg:22', scopeA);
    const other = new DiscussionRepository(db, 'tg:33', scopeB);
    const personal = new DiscussionRepository(db, 'tg:22', { realmId: 'tg:22', coachClientId: null });
    const anchor = { kind: 'program' as const, trainingPlanId: 'same-program-id' };
    const first = await coach.createThread(prepareDiscussionThread(anchor, 'Историческая программа', '2026-11-07'));
    const second = await client.createThread(prepareDiscussionThread(anchor, 'Вторая ветка', '2026-11-07'));
    const occurrence = await coach.createThread(prepareDiscussionThread({ kind: 'workout',
      workout: { kind: 'occurrence', id: 'occurrence' } }, 'Тренировка', '2026-11-07'));
    await other.createThread(prepareDiscussionThread(anchor, 'Другой тренер', '2026-11-07'));
    await personal.createThread(prepareDiscussionThread(anchor, 'Личная история до подключения', '2026-11-07'));
    const message = await coach.send(prepareDiscussionMessage(first.id, 'Сообщение'));
    await coach.send(prepareDiscussionMessage(second.id, 'Ещё одно'));
    await coach.send(prepareDiscussionMessage(occurrence.id, 'Отдельная тренировка'));
    await client.send(prepareDiscussionMessage(first.id, 'Свой ответ не является непрочитанным'));
    const snapshots: Array<{ threads: DiscussionThread[]; unread: number; unreadByThread: Record<string, number> }> = [];
    let ready: (() => void) | undefined;
    const initial = new Promise<void>(resolve => { ready = resolve; });
    const subscription = client.observeAnchor(anchor, value => {
      snapshots.push(value);
      if (value.unread === 2) ready?.();
    }, reason => { throw reason; });
    try {
      await initial;
      expect(snapshots.at(-1)?.unreadByThread).toEqual({ [first.id]: 1, [second.id]: 1 });
      expect(snapshots.at(-1)?.threads.map(row => row.id).sort()).toEqual([first.id, second.id].sort());
      await client.markRead(first.id, message.id);
      expect(await client.unreadForAnchor(anchor)).toBe(1);
      expect((await client.listThreads(anchor)).find(row => row.id === first.id)?.derivedTitleSnapshot)
        .toBe('Историческая программа · 2026-11-07');
      // Source data is not a repository access grant or a prerequisite for retained history.
      expect(await db.table('trainingPlans').count()).toBe(0);
      await expect(other.getMessage(first.id, message.id)).rejects.toThrow();
      await expect(new DiscussionRepository(db, 'tg:33', scopeA).listThreads(anchor)).rejects.toThrow('DISCUSSION_ACCESS_DENIED');
      expect((await personal.listThreads(anchor)).map(row => row.derivedTitleSnapshot))
        .toEqual(['Личная история до подключения · 2026-11-07']);
    } finally { subscription.unsubscribe(); }
  });
});
