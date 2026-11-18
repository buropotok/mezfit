// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import dexieCloud from 'dexie-cloud-addon';
import { afterEach, expect, it } from 'vitest';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import { CLOUD_DATABASE_STORES_V17, type MezfitCloudDatabase } from './database';
import { DiscussionOrganizationRepository, type AssignableDiscussionCategory } from './discussion-organization';
import { DiscussionRepository, prepareFreeDiscussion } from './discussions';

class CreationDatabase extends Dexie {
  declare flexAttributes: MezfitCloudDatabase['flexAttributes'];
  declare flexValues: MezfitCloudDatabase['flexValues'];
  declare adHocSessions: MezfitCloudDatabase['adHocSessions'];
  declare discussionThreads: MezfitCloudDatabase['discussionThreads'];
  declare discussionMessages: MezfitCloudDatabase['discussionMessages'];
  declare discussionReadStates: MezfitCloudDatabase['discussionReadStates'];
  declare realms: MezfitCloudDatabase['realms'];
  declare members: MezfitCloudDatabase['members'];

  constructor() {
    super('free-discussion-creation-' + crypto.randomUUID(), { addons: [dexieCloud] });
    this.version(17).stores(CLOUD_DATABASE_STORES_V17);
    this.cloud.configure({ databaseUrl: '', requireAuth: false, disableEagerSync: true,
      disableWebSocket: true, tryUseServiceWorker: false });
    databases.push(this);
  }
}

const databases: CreationDatabase[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) { db.close(); await db.delete(); }
});

function hydrate(db: CreationDatabase, stores: ReadonlyArray<readonly [string, readonly unknown[]]>) {
  return new Promise<void>((resolve, reject) => {
    const tx = db.backendDB().transaction(stores.map(([store]) => store), 'readwrite');
    for (const [store, records] of stores) for (const record of records) tx.objectStore(store).put(record);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}

it('projects created free chats and their explicit personal assignments from a separately hydrated database', async () => {
  const source = new CreationDatabase();
  const replica = new CreationDatabase();
  await Promise.all([source.open(), replica.open()]);
  const pairs = await Promise.all([relationshipMembership('11', '22'), relationshipMembership('33', '22')]);
  const realms = pairs.map(pair => pair.realm);
  const members = pairs.flatMap(pair => pair.members);
  await hydrate(source, [['realms', realms], ['members', members]]);
  const scope = { realmId: realms[1].realmId, coachClientId: realms[1].realmId };
  const client = new DiscussionRepository(source, 'tg:22', scope);
  const clientCategories = new DiscussionOrganizationRepository(source, 'tg:22');
  const coachCategories = new DiscussionOrganizationRepository(source, 'tg:33');
  const { id } = await clientCategories.createCategory('Привычки');
  const scenarios = [
    { assignment: 'nutrition', resolved: 'nutrition' },
    { assignment: 'personal', resolved: 'personal' },
    { assignment: { kind: 'custom', id }, resolved: `custom:${id}` },
  ] satisfies Array<{ assignment: AssignableDiscussionCategory; resolved: string }>;

  const created = [];
  for (const { assignment } of scenarios) {
    const thread = await client.createFreeDiscussion(prepareFreeDiscussion('Общий заголовок'));
    await coachCategories.assignThread(thread, 'personal');
    await clientCategories.assignThread(thread, assignment);
    created.push(thread);
  }

  // Seed the replica as after Addon hydration, using the exact committed records.
  await hydrate(replica, [
    ['realms', realms], ['members', members], ['discussionThreads', await source.discussionThreads.toArray()],
    ['flexAttributes', await source.flexAttributes.toArray()], ['flexValues', await source.flexValues.toArray()],
  ]);
  const rows = await new DiscussionRepository(replica, 'tg:22', scope).feed();
  const reopened = new DiscussionOrganizationRepository(replica, 'tg:22');
  const snapshot = await reopened.classifyThreads(rows.map(row => row.thread));
  const peer = new DiscussionOrganizationRepository(replica, 'tg:33');
  for (const [index, scenario] of scenarios.entries()) {
    const thread = created[index];
    expect(snapshot.threads.find(item => item.thread.id === thread.id)).toMatchObject({
      ownAssignment: scenario.resolved, category: scenario.assignment, peerCategorized: true,
    });
    await expect(peer.getThreadOrganization(thread)).resolves.toMatchObject({ ownAssignment: 'personal', category: 'personal' });
  }
  expect(rows).toHaveLength(3);
  expect(new Set(created.map(thread => thread.id)).size).toBe(3);
  expect(await peer.listCategories()).toEqual([]);
  const otherScope = { realmId: realms[0].realmId, coachClientId: realms[0].realmId };
  expect(await new DiscussionRepository(replica, 'tg:11', otherScope).feed()).toEqual([]);
});
