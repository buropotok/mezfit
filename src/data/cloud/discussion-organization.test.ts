// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import dexieCloud from 'dexie-cloud-addon';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import { CLOUD_DATABASE_STORES_V17, type MezfitCloudDatabase } from './database';
import { DiscussionRepository, prepareDiscussionThread, prepareFreeDiscussion } from './discussions';
import { FlexAttributesRepository, flexAttributeId, flexValueId, type FlexEntityTarget } from './flex-attributes';
import {
  DiscussionOrganizationRepository, DISCUSSION_CATEGORY_NAME_MAX_LENGTH,
  DISCUSSION_CATEGORY_KEY_PREFIX, decodeThreadAssignment, decodeCategoryDefinition,
  encodeCategoryDefinition, discussionCategoryKey, discussionThreadAssignmentKey,
  resolveDiscussionCategory, type CategoryId,
} from './discussion-organization';

class OrganizationTestDb extends Dexie {
  declare flexAttributes: MezfitCloudDatabase['flexAttributes'];
  declare flexValues: MezfitCloudDatabase['flexValues'];
  declare adHocSessions: MezfitCloudDatabase['adHocSessions'];
  declare discussionThreads: MezfitCloudDatabase['discussionThreads'];
  declare discussionMessages: MezfitCloudDatabase['discussionMessages'];
  declare discussionReadStates: MezfitCloudDatabase['discussionReadStates'];
  declare messageAttachments: MezfitCloudDatabase['messageAttachments'];
  declare realms: MezfitCloudDatabase['realms'];
  declare members: MezfitCloudDatabase['members'];
  constructor() {
    super('discussion-organization-' + crypto.randomUUID(), { addons: [dexieCloud] });
    this.version(17).stores(CLOUD_DATABASE_STORES_V17);
    this.cloud.configure({ databaseUrl: '', requireAuth: false, disableEagerSync: true,
      disableWebSocket: true, tryUseServiceWorker: false });
    databases.push(this);
  }
}
const databases: OrganizationTestDb[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) { db.close(); await db.delete(); }
  vi.restoreAllMocks();
});
const anchor = { kind: 'program' as const, trainingPlanId: 'shared-program-id' };
const target = (userId: string, realmId = userId): FlexEntityTarget =>
  userId === realmId ? { entityType: 'user', entityId: userId, realmId }
    : { entityType: 'publishedUser', entityId: userId, realmId };
async function fixture() {
  const db = new OrganizationTestDb(); await db.open();
  const pairs = await Promise.all([
    relationshipMembership('11', '22'), relationshipMembership('11', '44'), relationshipMembership('33', '22'),
  ]);
  await new Promise<void>((resolve, reject) => {
    const transaction = db.backendDB().transaction(['realms', 'members'], 'readwrite');
    for (const pair of pairs) {
      transaction.objectStore('realms').put(pair.realm);
      for (const member of pair.members) transaction.objectStore('members').put(member);
    }
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
  const scope = (index: number) => ({ realmId: pairs[index].realm.realmId, coachClientId: pairs[index].realm.realmId });
  const discussion = (userId: string, index: number) => new DiscussionRepository(db, userId, scope(index));
  const entity = await discussion('tg:11', 0).ensureEntityThread(anchor, 'Программа');
  const other = await discussion('tg:11', 1).ensureEntityThread(anchor, 'Программа');
  const free = await discussion('tg:22', 0).createFreeDiscussion(prepareFreeDiscussion('Свободный'));
  const personal = await new DiscussionRepository(db, 'tg:22', { realmId: 'tg:22', coachClientId: null })
    .createThread(prepareDiscussionThread(anchor, 'Личная', '2026-11-17'));
  return { db, scope, entity, other, free, personal,
    coach: new DiscussionOrganizationRepository(db, 'tg:11'),
    client: new DiscussionOrganizationRepository(db, 'tg:22'),
    otherClient: new DiscussionOrganizationRepository(db, 'tg:44') };
}

describe('discussion organization codecs', () => {
  it('separates namespaced 160-bit thread keys across realms and IDs', async () => {
    const id = '82cf2c4b-b4e0-4758-8dda-3f9c80f566ee' as CategoryId;
    const key = discussionCategoryKey(id);
    expect(key).toMatch(/^discussion_group_[a-f0-9]{32}$/);
    const thread = { id: 'entity-discussion:' + 'f'.repeat(64), realmId: 'realm-1' };
    const first = await discussionThreadAssignmentKey(thread);
    expect(first).toMatch(/^discussion_thread_[a-f0-9]{40}$/);
    expect(first.length).toBeLessThanOrEqual(64);
    expect(first).toBe(await discussionThreadAssignmentKey(thread));
    expect(first).not.toBe(await discussionThreadAssignmentKey({ ...thread, realmId: 'realm-2' }));
    expect(first).not.toBe(await discussionThreadAssignmentKey({ ...thread, id: 'another' }));
    expect(first).not.toBe(key);
    expect(decodeThreadAssignment('training')).toBeNull();
    expect(decodeThreadAssignment('coach')).toBeNull();
    expect(decodeThreadAssignment('+')).toBeNull();
    expect(decodeThreadAssignment('custom:not-a-uuid')).toBeNull();
    expect(decodeThreadAssignment('personal')).toBe('personal');
    expect(decodeThreadAssignment('custom:' + id)).toBe('custom:' + id);
    expect(resolveDiscussionCategory('free', null, null, null)).toBe('personal');
    expect(resolveDiscussionCategory('program', null, null, null)).toBe('training');
    expect(resolveDiscussionCategory('free', 'personal', 'nutrition', 'client')).toBe('personal');
    expect(resolveDiscussionCategory('program', null, 'personal', 'coach')).toBe('coach');
  });
  it('strictly validates bounded category JSON without embedding names into the key', () => {
    const id = '82cf2c4b-b4e0-4758-8dda-3f9c80f566ee' as CategoryId;
    const category = { id, name: ' План ', order: 4 };
    const encoded = encodeCategoryDefinition(category);
    expect(decodeCategoryDefinition(discussionCategoryKey(id), encoded))
      .toEqual({ ...category, name: 'План' });
    expect(decodeCategoryDefinition(discussionCategoryKey(id), '{"v":1,"name":"План","order":4,"extra":1}')).toBeNull();
    expect(decodeCategoryDefinition(discussionCategoryKey(id), '{"v":1,"name":"План","order":-1}')).toBeNull();
    expect(decodeCategoryDefinition('discussion_group_bad', encoded)).toBeNull();
    expect(() => encodeCategoryDefinition({ ...category, name: 'a'.repeat(DISCUSSION_CATEGORY_NAME_MAX_LENGTH + 1) })).toThrow();
  });
});

describe('typed Flex persistence and participant isolation', () => {
  it('keeps many category values separate, stable over rename/reorder and private to the actor', async () => {
    const { db, coach, client } = await fixture();
    const first = await coach.createCategory(' Техника ');
    for (let i = 0; i < 30; i++) await coach.createCategory('Группа ' + i);
    expect((await coach.listCategories()).length).toBe(31);
    expect((await db.flexAttributes.where('realmId').equals('tg:11').toArray())
      .filter(row => row.key.startsWith(DISCUSSION_CATEGORY_KEY_PREFIX))).toHaveLength(31);
    expect(await client.listCategories()).toEqual([]);
    await expect(coach.createCategory('техника')).rejects.toThrow('DUPLICATE_DISCUSSION_CATEGORY_NAME');
    await expect(coach.createCategory('Тренировки')).rejects.toThrow('INVALID_DISCUSSION_CATEGORY_NAME');
    await expect(coach.createCategory('  ')).rejects.toThrow('INVALID_DISCUSSION_CATEGORY_NAME');
    await coach.renameCategory(first.id, 'Новая техника');
    expect((await coach.listCategories()).find(row => row.id === first.id)?.name).toBe('Новая техника');
    const reverse = (await coach.listCategories()).map(row => row.id).reverse();
    await coach.reorderCategories(reverse);
    expect((await coach.listCategories()).map(row => row.id)).toEqual(reverse);
    await expect(coach.reorderCategories(reverse.slice(1))).rejects.toThrow('INVALID_DISCUSSION_CATEGORY_ORDER');
    const stored = await db.flexValues.get(flexValueId(target('tg:11'), flexAttributeId('tg:11', discussionCategoryKey(first.id))));
    expect(stored?.value).toContain('Новая техника');
  });

  it('keeps reads reactive but rejects category edits while a definition is awaiting its value', async () => {
    const { db, coach } = await fixture();
    const existing = await coach.createCategory('Первая');
    const pendingId = '49a87f72-f6d9-478a-afba-893f7eb65790' as CategoryId;
    const key = discussionCategoryKey(pendingId);
    await db.flexAttributes.add({ id: flexAttributeId('tg:11', key), realmId: 'tg:11',
      owner: 'tg:11', key, valueType: 'string' });
    expect((await coach.readCategories()).diagnostics).toContain('CATEGORY_PENDING:' + key);
    await expect(coach.createCategory('Новая')).rejects.toThrow('DISCUSSION_CATEGORIES_INCOMPLETE');
    await expect(coach.renameCategory(existing.id, 'Переименованная'))
      .rejects.toThrow('DISCUSSION_CATEGORIES_INCOMPLETE');
    await expect(coach.reorderCategories([existing.id])).rejects.toThrow('DISCUSSION_CATEGORIES_INCOMPLETE');
    await new FlexAttributesRepository(db, 'tg:11').clearValue(target('tg:11'), key, 'string');
    expect((await coach.readCategories()).diagnostics).toEqual([]);
    await coach.renameCategory(existing.id, 'Переименованная');
    expect((await coach.listCategories())[0]?.name).toBe('Переименованная');
  });

  it('resolves default entity/free/personal, explicit personal, peer-only tab and own precedence', async () => {
    const { db, scope, entity, free, personal, coach, client } = await fixture();
    expect((await coach.classifyThreads([entity, free])).threads.map(row => row.category)).toEqual(['training', 'personal']);
    expect((await client.getThreadOrganization(personal)).category).toBe('training');
    const secret = await coach.createCategory('Только для тренера');
    await coach.assignThread(entity, { kind: 'custom', id: secret.id });
    expect((await coach.getThreadOrganization(entity)).category).toEqual({ kind: 'custom', id: secret.id });
    const counterpart = await client.getThreadOrganization(entity);
    expect(counterpart.category).toBe('coach');
    expect(JSON.stringify(counterpart)).not.toContain(secret.name);
    await client.assignThread(entity, 'nutrition');
    expect((await client.getThreadOrganization(entity)).category).toBe('nutrition');
    expect((await coach.getThreadOrganization(entity)).category).toEqual({ kind: 'custom', id: secret.id });
    const assignmentKey = await discussionThreadAssignmentKey(entity);
    expect((await db.flexValues.get(flexValueId(target('tg:11', scope(0).realmId),
      flexAttributeId(scope(0).realmId, assignmentKey))))?.value).toBe('custom:' + secret.id);
    expect((await db.flexValues.get(flexValueId(target('tg:22', scope(0).realmId),
      flexAttributeId(scope(0).realmId, assignmentKey))))?.value).toBe('nutrition');
    await client.clearThreadAssignment(entity);
    expect((await client.getThreadOrganization(entity)).category).toBe('coach');
    await coach.clearThreadAssignment(entity);
    expect((await client.getThreadOrganization(entity)).category).toBe('training');
    await coach.assignThread(free, 'nutrition');
    expect((await client.getThreadOrganization(free)).category).toBe('coach');
    await client.assignThread(free, 'personal');
    expect((await client.getThreadOrganization(free)).category).toBe('personal');
    await client.clearThreadAssignment(free);
    expect((await client.getThreadOrganization(free)).category).toBe('coach');
    await client.assignThread(personal, 'nutrition');
    expect((await client.getThreadOrganization(personal)).category).toBe('nutrition');
    expect((await coach.classifyThreads([entity, entity])).threads).toHaveLength(1);
  });

  it('isolates multiple pairs, rejects foreign targets and never reads foreign personal categories', async () => {
    const { db, scope, entity, other, coach, client, otherClient } = await fixture();
    const category = await client.createCategory('Скрытый раздел');
    await client.assignThread(entity, { kind: 'custom', id: category.id });
    expect((await coach.getThreadOrganization(entity)).category).toBe('client');
    expect((await otherClient.getThreadOrganization(other)).category).toBe('training');
    await coach.assignThread(other, 'nutrition');
    expect((await otherClient.getThreadOrganization(other)).category).toBe('coach');
    await expect(otherClient.assignThread(entity, 'nutrition')).rejects.toThrow('DISCUSSION_ACCESS_DENIED');
    await expect(coach.getThreadOrganization({ ...entity, derivedTitleSnapshot: 'Подменённый заголовок' }))
      .rejects.toThrow('DISCUSSION_NOT_FOUND');
    await expect(coach.assignThread(entity, { kind: 'custom', id: category.id }))
      .rejects.toThrow('DISCUSSION_CATEGORY_NOT_FOUND');
    await expect(client.assignThread(entity, 'training' as never)).rejects.toThrow('INVALID_DISCUSSION_ASSIGNMENT');
    await expect(new DiscussionOrganizationRepository(db, 'tg:33').classifyThreads([entity]))
      .rejects.toThrow('DISCUSSION_ACCESS_DENIED');
    await expect(new FlexAttributesRepository(db, 'tg:11').setValue(target('tg:22', scope(0).realmId),
      { key: await discussionThreadAssignmentKey(entity), valueType: 'string', value: 'nutrition' }))
      .rejects.toThrow('FLEX_ENTITY_FORBIDDEN');
    expect(await coach.listCategories()).toEqual([]);
    expect(await otherClient.listCategories()).toEqual([]);
  });

  it('falls back per damaged/pending key while exposing diagnostics and never hides access errors', async () => {
    const { db, scope, entity, free, coach, client, otherClient } = await fixture();
    await coach.assignThread(entity, 'nutrition');
    await coach.assignThread(free, 'personal');
    const key = await discussionThreadAssignmentKey(entity);
    const attributeId = flexAttributeId(scope(0).realmId, key);
    const valueId = flexValueId(target('tg:11', scope(0).realmId), attributeId);
    await db.flexValues.update(valueId, { value: 'training' });
    const result = await coach.classifyThreads([entity, free]);
    expect(result.threads.map(row => row.category)).toEqual(['training', 'personal']);
    expect(result.threads[0].diagnostics).toContain('OWN_ASSIGNMENT_INVALID_OR_STALE');
    await db.flexValues.update(valueId, { value: 'nutrition' });
    await db.flexAttributes.delete(attributeId); // simulate value hydration before its add-only definition
    expect((await client.getThreadOrganization(entity)).diagnostics).toContain('PEER_ASSIGNMENT_PENDING');
    await db.flexAttributes.add({ id: attributeId, realmId: scope(0).realmId,
      owner: scope(0).realmId, key, valueType: 'string' });
    expect((await client.getThreadOrganization(entity)).category).toBe('coach');
    const ownCategory = await client.createCategory('Повреждённая');
    await client.assignThread(free, { kind: 'custom', id: ownCategory.id });
    await db.flexValues.update(flexValueId(target('tg:22'),
      flexAttributeId('tg:22', discussionCategoryKey(ownCategory.id))), { value: 'invalid JSON' });
    const fallback = await client.getThreadOrganization(free);
    expect(fallback.category).toBe('coach');
    expect(fallback.diagnostics).toContain('OWN_ASSIGNMENT_INVALID_OR_STALE');
    expect((await client.readCategories()).diagnostics.length).toBeGreaterThan(0);
    await expect(otherClient.classifyThreads([entity])).rejects.toThrow('DISCUSSION_ACCESS_DENIED');
  });

  it('clears own links in both shared realms and personal realm without touching peer assignments', async () => {
    const { db, scope, entity, other, personal, coach, client } = await fixture();
    const category = await coach.createCategory('Удаляемая');
    await coach.assignThread(entity, { kind: 'custom', id: category.id });
    await coach.assignThread(other, { kind: 'custom', id: category.id });
    const ownPersonal = await new DiscussionRepository(db, 'tg:11', { realmId: 'tg:11', coachClientId: null })
      .createThread(prepareDiscussionThread(anchor, 'Мой план', '2026-11-17'));
    await coach.assignThread(ownPersonal, { kind: 'custom', id: category.id });
    await client.assignThread(entity, 'personal');
    await coach.removeCategory(category.id);
    expect(await coach.listCategories()).toEqual([]);
    const categoryValueId = flexValueId(target('tg:11'),
      flexAttributeId('tg:11', discussionCategoryKey(category.id)));
    expect((await db.flexValues.get(categoryValueId))?.value).toBeNull();
    for (const thread of [entity, other, ownPersonal]) {
      const key = await discussionThreadAssignmentKey(thread);
      const scopeTarget = target('tg:11', thread.realmId);
      const assignmentValueId = flexValueId(scopeTarget, flexAttributeId(thread.realmId, key));
      expect((await db.flexValues.get(assignmentValueId))?.value).toBeNull();
    }
    expect((await client.getThreadOrganization(entity)).category).toBe('personal');
    expect((await coach.getThreadOrganization(entity)).category).toBe('client');
    const staleId = flexValueId(target('tg:11', scope(0).realmId),
      flexAttributeId(scope(0).realmId, await discussionThreadAssignmentKey(entity)));
    await db.flexValues.update(staleId, { value: 'custom:' + category.id });
    expect((await coach.getThreadOrganization(entity)).category).toBe('client');
    await coach.removeCategory(category.id); // repeat a tombstoned deletion after late hydration
    expect((await db.flexValues.get(staleId))?.value).toBeNull();
    expect((await client.getThreadOrganization(personal)).category).toBe('training');
  });


  it('cleans a pending value whose definition is not yet hydrated before the category tombstone', async () => {
    const { db, entity, coach } = await fixture();
    const category = await coach.createCategory('Ожидающий метаданные раздел');
    await coach.assignThread(entity, { kind: 'custom', id: category.id });
    const key = await discussionThreadAssignmentKey(entity);
    const attributeId = flexAttributeId(entity.realmId, key);
    const valueId = flexValueId(target('tg:11', entity.realmId), attributeId);
    await db.flexAttributes.delete(attributeId); // only in test: imitate Addon value-first hydration
    expect((await db.flexValues.get(valueId))?.value).toBe('custom:' + category.id);
    await coach.removeCategory(category.id);
    expect((await db.flexAttributes.get(attributeId))?.valueType).toBe('string');
    expect((await db.flexValues.get(valueId))?.value).toBeNull();
    expect(await coach.listCategories()).toEqual([]);
  });

  it('defers category deletion while a Flex assignment definition has no hydrated value', async () => {
    const { db, entity, coach } = await fixture();
    const category = await coach.createCategory('Ожидает значения');
    const key = await discussionThreadAssignmentKey({ id: 'pending-value', realmId: entity.realmId });
    const attributeId = flexAttributeId(entity.realmId, key);
    await db.flexAttributes.add({ id: attributeId, realmId: entity.realmId, owner: entity.realmId,
      key, valueType: 'string' });
    await expect(coach.removeCategory(category.id)).rejects.toThrow('DISCUSSION_CATEGORY_CLEANUP_INCOMPLETE');
    expect((await coach.listCategories()).map(row => row.id)).toContain(category.id);
    await new FlexAttributesRepository(db, 'tg:11').setValue(target('tg:11', entity.realmId),
      { key, valueType: 'string', value: null });
    await coach.removeCategory(category.id);
    expect(await coach.listCategories()).toEqual([]);
  });

  it('reports failed cleanup and supports explicit retry without prematurely removing category', async () => {
    const { entity, coach } = await fixture();
    const category = await coach.createCategory('Повторить');
    await coach.assignThread(entity, { kind: 'custom', id: category.id });
    const spy = vi.spyOn(FlexAttributesRepository.prototype, 'setValues')
      .mockRejectedValueOnce(new Error('SIMULATED_REALM_FAILURE'));
    await expect(coach.removeCategory(category.id)).rejects.toThrow('SIMULATED_REALM_FAILURE');
    spy.mockRestore();
    expect((await coach.listCategories()).map(item => item.id)).toContain(category.id);
    await coach.removeCategory(category.id);
    expect(await coach.listCategories()).toEqual([]);
  });

  it('exposes a single reactive subscription for category and feed projections', async () => {
    const { coach, entity } = await fixture();
    const categories: number[] = [], assignments: string[] = [];
    const categorySub = coach.observeCategories(value => categories.push(value.categories.length), error => { throw error; });
    const feedSub = coach.observe([entity], result => {
      const value = result.threads[0]?.category;
      if (typeof value === 'string') assignments.push(value);
    }, error => { throw error; });
    try {
      await vi.waitFor(() => expect(categories).toContain(0));
      await vi.waitFor(() => expect(assignments).toContain('training'));
      await coach.createCategory('Реактивная');
      await vi.waitFor(() => expect(categories).toContain(1));
      await coach.assignThread(entity, 'nutrition');
      await vi.waitFor(() => expect(assignments).toContain('nutrition'));
    } finally { categorySub.unsubscribe(); feedSub.unsubscribe(); }
  });
});
